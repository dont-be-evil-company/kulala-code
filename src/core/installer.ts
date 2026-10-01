import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { corePath, coreVersion, downloadUrlTemplate } from "../config";
import {
  LICENSE_TOKEN_HELP,
  throwIfLicenseRejected,
  withLicenseToken,
} from "./license-token";
import { installedBinaryName, releaseAssetName } from "./platform";

export function binDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "bin");
}

export function installedBinaryPath(context: vscode.ExtensionContext): string {
  return path.join(binDir(context), installedBinaryName());
}

function versionFile(context: vscode.ExtensionContext): string {
  return path.join(binDir(context), "version.txt");
}

export function getInstalledVersion(context: vscode.ExtensionContext): string | undefined {
  try {
    return fs.readFileSync(versionFile(context), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

const VERSION_PROBE_TIMEOUT_MS = 15_000;

function firstOutputLine(stdout: string): string {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function runVersion(binPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binPath,
      ["--version"],
      { timeout: VERSION_PROBE_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        if (!firstOutputLine(stdout)) {
          reject(new Error("kulala-core --version produced no output"));
          return;
        }
        resolve();
      },
    );
  });
}

function clearQuarantine(binPath: string): Promise<void> {
  return new Promise((resolve) => {
    execFile("xattr", ["-d", "com.apple.quarantine", binPath], { timeout: 5_000 }, () => {
      resolve();
    });
  });
}

async function assertCoreStarts(binPath: string): Promise<void> {
  try {
    await runVersion(binPath);
    return;
  } catch (error) {
    if (process.platform === "darwin") {
      await clearQuarantine(binPath);
      try {
        await runVersion(binPath);
        return;
      } catch {
        await fs.promises.rm(binPath, { force: true });
        throw new Error(
          "macOS refused to start kulala-core. The downloaded binary is signed incorrectly or blocked by Gatekeeper.",
        );
      }
    }
    await fs.promises.rm(binPath, { force: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`kulala-core --version failed. The downloaded binary did not start. ${detail}`);
  }
}

async function downloadFile(url: string, dest: string, token: string): Promise<void> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  throwIfLicenseRejected(res.status);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(dest, buf);
}

async function promptLicenseToken(): Promise<string> {
  const value = await vscode.window.showInputBox({
    password: true,
    ignoreFocusOut: true,
    title: "Kulala license token",
    prompt: "Enter your Kulala Core license token",
  });
  if (!value?.trim()) {
    throw new Error(`No license token entered. ${LICENSE_TOKEN_HELP}`);
  }
  return value.trim();
}

async function installCore(context: vscode.ExtensionContext): Promise<string> {
  const configured = corePath();
  if (configured) {
    if (!fs.existsSync(configured)) {
      throw new Error(`kulala.corePath does not exist: ${configured}`);
    }
    return configured;
  }

  const version = coreVersion();
  const binPath = installedBinaryPath(context);
  const installed = getInstalledVersion(context);

  if (fs.existsSync(binPath) && installed === version) {
    return binPath;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Kulala",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: `Downloading kulala-core v${version}…` });
      await fs.promises.mkdir(binDir(context), { recursive: true });

      const asset = releaseAssetName();
      const url = downloadUrlTemplate().replace("%s", version).replace("%s", asset);
      const tmp = `${binPath}.download`;

      try {
        await withLicenseToken({
          allowPrompt: true,
          prompt: promptLicenseToken,
          download: async (token) => {
            await downloadFile(url, tmp, token);
          },
        });
        await fs.promises.rename(tmp, binPath);
      } catch (error) {
        await fs.promises.rm(tmp, { force: true });
        throw error;
      }
      if (process.platform !== "win32") {
        await fs.promises.chmod(binPath, 0o755);
      }
      await assertCoreStarts(binPath);
      await fs.promises.writeFile(versionFile(context), version, "utf8");
    },
  );

  return binPath;
}

let pendingInstall: Promise<string> | undefined;

/** One in-flight download. A failed or cancelled prompt can be retried later. */
export function ensureCoreInstalled(context: vscode.ExtensionContext): Promise<string> {
  if (pendingInstall) return pendingInstall;

  pendingInstall = installCore(context)
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Kulala: ${msg}`);
      throw error;
    })
    .finally(() => {
      pendingInstall = undefined;
    });

  return pendingInstall;
}

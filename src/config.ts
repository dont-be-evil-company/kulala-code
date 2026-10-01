import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { DEFAULT_CORE_VERSION } from "./constants";

export function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("kulala");
}

export function corePath(): string | undefined {
  const p = getConfig().get<string>("corePath", "").trim();
  return p || undefined;
}

export function coreVersion(): string {
  return getConfig().get<string>("coreVersion", DEFAULT_CORE_VERSION);
}

export function timeoutMs(): number {
  return getConfig().get<number>("timeout", 60000);
}

export function defaultEnv(): string {
  return getConfig().get<string>("defaultEnv", "default");
}

export function downloadUrlTemplate(): string {
  return getConfig().get<string>(
    "downloadUrl",
    "https://core.kulala.app/releases/%s/%s",
  );
}

/** Matches kulala-core `getKulalaCoreDataDir`. */
export function effectiveDataDir(): string {
  const override = getConfig().get<string>("dataDir", "").trim();
  if (override) {
    return override;
  }
  const fromEnv = process.env.KULALA_CORE_DATA_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      return path.join(local, "kulala-core");
    }
    return path.join(os.homedir(), "kulala-core");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "kulala-core");
  }
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) {
    return path.join(xdg, "kulala-core");
  }
  return path.join(os.homedir(), ".local", "share", "kulala-core");
}

export function responseViewColumn(): vscode.ViewColumn {
  const mode = getConfig().get<string>("responseView", "beside");
  switch (mode) {
    case "active":
      return vscode.ViewColumn.Active;
    case "below":
      return vscode.ViewColumn.Three;
    default:
      return vscode.ViewColumn.Beside;
  }
}

/** First editor column beside the HTTP file (OpenAPI explorer). */
export function openapiViewColumn(): vscode.ViewColumn {
  return vscode.ViewColumn.Beside;
}

/** Second split when OpenAPI explorer is already open (response panel). */
export function responseViewColumnAfterOpenapi(): vscode.ViewColumn {
  return vscode.ViewColumn.Three;
}

export function selectedEnvKey(folderUri?: vscode.Uri): string {
  const key = folderUri?.fsPath ?? "global";
  return `kulala.selectedEnv:${key}`;
}

export function getSelectedEnv(
  context: vscode.ExtensionContext,
  folder?: vscode.WorkspaceFolder,
): string {
  const key = selectedEnvKey(folder?.uri);
  return context.workspaceState.get<string>(key) ?? defaultEnv();
}

export async function setSelectedEnv(
  context: vscode.ExtensionContext,
  env: string,
  folder?: vscode.WorkspaceFolder,
): Promise<void> {
  const key = selectedEnvKey(folder?.uri);
  await context.workspaceState.update(key, env);
}

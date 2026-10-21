import * as path from "node:path";
import * as vscode from "vscode";
import { defaultEnv, getConfig, getSelectedEnv } from "../config";
import { HTTP_FILETYPES } from "../constants";
import type { KulalaLspFiletype } from "../core/types";

export type { KulalaLspFiletype };

/** kulala-core `LspSupportedExternalScriptFiletypes` */
export const KULALA_SCRIPT_LANGS = ["javascript"] as const;

export type KulalaLspContext = {
  content: string;
  filepath?: string;
  cwd: string;
  /** 1-based line for kulala-core stdin */
  line: number;
  /** 1-based column for kulala-core stdin */
  column: number;
  filetype: KulalaLspFiletype;
  env: string;
};

export function isHttpDocument(doc: vscode.TextDocument): boolean {
  return doc.languageId === "http" || doc.languageId === "rest";
}

/** External script file linked to an .http collection (`api.http.js`). */
export function isHttpScriptFile(doc: vscode.TextDocument): boolean {
  if (!(KULALA_SCRIPT_LANGS as readonly string[]).includes(doc.languageId)) {
    return false;
  }
  const enforce = getConfig().get<boolean>("enforceExternalScriptNamingConvention", true);
  if (!enforce) {
    return true;
  }
  const name = doc.uri.scheme === "file" ? path.basename(doc.uri.fsPath) : doc.fileName;
  return /\.http\.js$/i.test(name);
}

/** Documents that receive kulala-core completion, hover, and (for .http) diagnostics. */
export function supportsKulalaLsp(doc: vscode.TextDocument): boolean {
  if (isHttpDocument(doc)) {
    return true;
  }
  return isHttpScriptFile(doc);
}

export function kulalaLspFiletype(doc: vscode.TextDocument): KulalaLspFiletype {
  if (isHttpDocument(doc)) {
    return doc.languageId as "http" | "rest";
  }
  return doc.languageId as (typeof KULALA_SCRIPT_LANGS)[number];
}

export function lspContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  extensionContext: vscode.ExtensionContext,
): KulalaLspContext {
  const filepath = document.uri.scheme === "file" ? document.uri.fsPath : undefined;
  let cwd = filepath ? path.dirname(filepath) : undefined;
  if (!cwd || !path.isAbsolute(cwd)) {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    cwd = folder?.uri.fsPath ?? process.cwd();
  }
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const env = getSelectedEnv(extensionContext, folder) || defaultEnv();

  return {
    content: document.getText(),
    filepath,
    cwd,
    line: position.line + 1,
    column: position.character + 1,
    filetype: kulalaLspFiletype(document),
    env,
  };
}

export function lspContextForDocument(
  document: vscode.TextDocument,
  extensionContext: vscode.ExtensionContext,
): Omit<KulalaLspContext, "line" | "column"> {
  const pos = new vscode.Position(0, 0);
  const ctx = lspContext(document, pos, extensionContext);
  return {
    content: ctx.content,
    filepath: ctx.filepath,
    cwd: ctx.cwd,
    filetype: ctx.filetype,
    env: ctx.env,
  };
}

export const kulalaLspDocumentSelector: vscode.DocumentSelector = [
  ...HTTP_FILETYPES.map((language) => ({ language })),
  ...KULALA_SCRIPT_LANGS.map((language) => ({ language })),
];

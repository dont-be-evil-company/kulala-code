import * as path from "node:path";
import * as vscode from "vscode";
import { TRIGGER_CHARS } from "./constants";
import { getSelectedEnv } from "./config";
import { KulalaCoreBridge } from "./core/bridge";
import { documentContext, isHttpDocument, revivePosition } from "./document";
import { pickEnvironment } from "./envManager";
import { kulalaLspDocumentSelector } from "./lsp/context";
import { KulalaCodeLensProvider } from "./providers/codelens";
import { KulalaCompletionProvider } from "./providers/completion";
import { KulalaDiagnostics } from "./providers/diagnostics";
import { KulalaDocumentSymbolProvider } from "./providers/documentSymbols";
import { KulalaHoverProvider } from "./providers/hover";
import { OpenAPIPanel } from "./openapi/panel";
import { ResponsePanel } from "./response/panel";
import { RequestRunner } from "./runner";
import { KulalaStatusBar } from "./statusBar";
import { registerKulalaSyntax } from "./syntax";

const httpSelector: vscode.DocumentSelector = [{ language: "http" }, { language: "rest" }];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const bridge = new KulalaCoreBridge(context);
  const responsePanel = new ResponsePanel(context);
  const openapiPanel = new OpenAPIPanel(context);
  const runner = new RequestRunner(bridge, context, responsePanel, openapiPanel);
  const diagnostics = new KulalaDiagnostics(bridge, context);
  const statusBar = new KulalaStatusBar(context);

  await registerKulalaSyntax(context);

  const completion = new KulalaCompletionProvider(bridge, context);
  const hover = new KulalaHoverProvider(bridge, context);
  const symbols = new KulalaDocumentSymbolProvider(bridge, context);

  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerCodeLensProvider(httpSelector, new KulalaCodeLensProvider(bridge)),
    vscode.languages.registerCompletionItemProvider(
      kulalaLspDocumentSelector,
      completion,
      ...TRIGGER_CHARS,
    ),
    vscode.languages.registerHoverProvider(kulalaLspDocumentSelector, hover),
    vscode.languages.registerDocumentSymbolProvider(httpSelector, symbols),
  );

  const refreshDiagnostics = (doc: vscode.TextDocument) => diagnostics.schedule(doc);
  for (const doc of vscode.workspace.textDocuments) {
    if (isHttpDocument(doc)) refreshDiagnostics(doc);
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isHttpDocument(e.document)) refreshDiagnostics(e.document);
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isHttpDocument(doc)) refreshDiagnostics(doc);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.clear(doc)),
  );

  const activeHttpEditor = (): vscode.TextEditor | undefined => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isHttpDocument(editor.document)) {
      void vscode.window.showWarningMessage("Open an .http or .rest file to use Kulala.");
      return undefined;
    }
    return editor;
  };

  /** Optional `atLine` from CodeLens (0-based); otherwise uses cursor. */
  const runSend = async (atLine?: number) => {
    const editor = activeHttpEditor();
    if (!editor) return;

    const pos =
      typeof atLine === "number"
        ? revivePosition({ line: atLine, character: 0 }, editor.selection.active)
        : editor.selection.active;
    editor.selection = new vscode.Selection(pos, pos);

    const ctx = documentContext(editor);
    await runner.runAtCursor(ctx);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("kulala.sendRequest", runSend),
    vscode.commands.registerCommand("kulala.sendAllRequests", async () => {
      const editor = activeHttpEditor();
      if (!editor) return;
      await runner.runAll(documentContext(editor));
    }),
    vscode.commands.registerCommand("kulala.cancelRequest", () => runner.cancel()),
    vscode.commands.registerCommand("kulala.showResponse", () => responsePanel.revealLast()),
    vscode.commands.registerCommand("kulala.openOpenapiExplorer", async (atLine?: number) => {
      const editor = activeHttpEditor();
      if (!editor) return;
      const pos =
        typeof atLine === "number"
          ? revivePosition({ line: atLine, character: 0 }, editor.selection.active)
          : editor.selection.active;
      editor.selection = new vscode.Selection(pos, pos);
      await runner.openOpenapiExplorer(documentContext(editor));
    }),
    vscode.commands.registerCommand("kulala.copyOpenapiAsHttp", () =>
      runner.copyLastOpenApiAsHttp(),
    ),
    vscode.commands.registerCommand("kulala.clearOpenapiSchemaCache", async () => {
      const editor = vscode.window.activeTextEditor;
      const cwd =
        editor?.document.uri.scheme === "file"
          ? path.dirname(editor.document.uri.fsPath)
          : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
      const { result, err } = await bridge.clearOpenapiSchema(undefined, cwd);
      if (err || !result) {
        void vscode.window.showErrorMessage(err ?? "Failed to clear OpenAPI schema cache.");
        return;
      }
      const n = result.cleared;
      void vscode.window.showInformationMessage(
        n === 0
          ? "No cached OpenAPI schemas to clear."
          : `Cleared ${n} OpenAPI schema cache${n === 1 ? "" : "s"}.`,
      );
    }),
    vscode.commands.registerCommand("kulala.selectEnvironment", async () => {
      const editor = vscode.window.activeTextEditor;
      const cwd =
        editor?.document.uri.scheme === "file"
          ? path.dirname(editor.document.uri.fsPath)
          : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
      await pickEnvironment(bridge, context, cwd);
      statusBar.update(context);
      for (const doc of vscode.workspace.textDocuments) {
        if (isHttpDocument(doc)) refreshDiagnostics(doc);
      }
    }),
    vscode.commands.registerCommand("kulala.copyAsCurl", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isHttpDocument(editor.document)) return;
      const ctx = documentContext(editor);
      const curl = await bridge.toCurl(ctx.content, ctx.filepath, ctx.line, ctx.column, ctx.cwd);
      if (!curl) {
        void vscode.window.showWarningMessage("Could not build cURL for this position.");
        return;
      }
      await vscode.env.clipboard.writeText(curl);
      void vscode.window.showInformationMessage("Copied cURL to clipboard.");
    }),
    vscode.commands.registerCommand("kulala.pasteFromCurl", async () => {
      const curl = await vscode.env.clipboard.readText();
      if (!curl.trim()) {
        void vscode.window.showWarningMessage("Clipboard is empty.");
        return;
      }
      const editor = vscode.window.activeTextEditor;
      const cwd =
        editor?.document.uri.scheme === "file"
          ? path.dirname(editor.document.uri.fsPath)
          : process.cwd();
      const http = await bridge.fromCurl(curl, cwd);
      if (!http) {
        void vscode.window.showWarningMessage("Could not parse cURL.");
        return;
      }
      if (editor && isHttpDocument(editor.document)) {
        await editor.edit((eb) => eb.insert(editor.selection.active, http));
      } else {
        const doc = await vscode.workspace.openTextDocument({ language: "http", content: http });
        await vscode.window.showTextDocument(doc);
      }
    }),
    vscode.commands.registerCommand("kulala.inspectRequest", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isHttpDocument(editor.document)) return;
      const ctx = documentContext(editor);
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      const env = getSelectedEnv(context, folder);
      const out = await bridge.inspectRequest(
        ctx.content,
        ctx.filepath,
        ctx.line,
        ctx.column,
        env,
        ctx.cwd,
      );
      if (!out) {
        void vscode.window.showWarningMessage("Nothing to inspect at cursor.");
        return;
      }
      const doc = await vscode.workspace.openTextDocument({
        language: "json",
        content: out,
      });
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
    }),
    vscode.commands.registerCommand("kulala.clearGlobals", async () => {
      const editor = vscode.window.activeTextEditor;
      const cwd =
        editor?.document.uri.scheme === "file"
          ? path.dirname(editor.document.uri.fsPath)
          : process.cwd();
      await bridge.clearGlobals(cwd);
      void vscode.window.showInformationMessage("Kulala script globals cleared.");
    }),
    vscode.commands.registerCommand("kulala.applyJqFilter", () => runner.promptJqFilter()),
    vscode.commands.registerCommand("kulala.closeWebSocket", () => runner.closeWebSocket()),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (e && isHttpDocument(e.document)) {
        diagnostics.schedule(e.document);
      }
    }),
  );
}

export function deactivate(): void {}

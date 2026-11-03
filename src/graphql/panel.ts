import * as vscode from "vscode";
import type { GraphQLExplorerEdit, GraphQLViewState } from "../../shared/graphql-view";
import type { KulalaCoreBridge } from "../core/bridge";
import type { GraphQLExplorerPatchResult, GraphQLExplorerPayload } from "../core/types";
import type { DocumentContext } from "../document";
import { graphqlViewColumn } from "../config";
import { postGraphqlState, renderGraphqlWebview, webviewDistUri } from "../response/webview-html";

export type GraphQLPanelContext = DocumentContext & {
  env: string;
};

export type GraphQLPanelHandlers = {
  onRun?: () => void;
};

function vscodeTheme(): "light" | "dark" {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? "light"
    : "dark";
}

function stringPath(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value;
}

function viewState(payload: GraphQLExplorerPayload): Omit<GraphQLViewState, "theme"> {
  return {
    endpoint: payload.endpoint,
    cacheKey: payload.cacheKey,
    operation: payload.operation,
    patchable: payload.patchable,
    reason: payload.reason,
    schema: payload.schema,
    checkedFields: payload.checkedFields ?? [],
    checkedArgs: payload.checkedArgs ?? [],
    argValues: payload.argValues ?? {},
  };
}

export class GraphQLPanel {
  private panel: vscode.WebviewPanel | undefined;
  private payload: GraphQLExplorerPayload | undefined;
  private parentCtx: GraphQLPanelContext | undefined;
  private handlers: GraphQLPanelHandlers = {};
  private webviewHtmlReady = false;
  private applying = false;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly bridge: KulalaCoreBridge,
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.applying || !this.parentCtx?.filepath) return;
        if (event.document.uri.fsPath !== this.parentCtx.filepath) return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          void this.reload();
        }, 200);
      }),
    );
  }

  setHandlers(handlers: GraphQLPanelHandlers): void {
    this.handlers = handlers;
  }

  isOpen(): boolean {
    return this.panel !== undefined;
  }

  getParentContext(): GraphQLPanelContext | undefined {
    return this.liveContext();
  }

  show(payload: GraphQLExplorerPayload, ctx: GraphQLPanelContext): void {
    this.parentCtx = ctx;
    this.payload = payload;
    this.ensurePanel();
    void this.rewriteLoaded(payload);
    this.updateWebview();
  }

  private liveContext(): GraphQLPanelContext | undefined {
    if (!this.parentCtx) return undefined;
    const filepath = this.parentCtx.filepath;
    if (!filepath) return this.parentCtx;
    const document = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === filepath);
    if (!document) return this.parentCtx;
    return { ...this.parentCtx, content: document.getText() };
  }

  private ensurePanel(): void {
    if (this.panel) {
      this.panel.reveal(graphqlViewColumn());
      return;
    }
    this.panel = vscode.window.createWebviewPanel("kulalaGraphql", "GraphQL", graphqlViewColumn(), {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [webviewDistUri(this.context.extensionUri)],
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.webviewHtmlReady = false;
    });
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (!msg || typeof msg !== "object" || !("type" in msg)) return;
      if (msg.type === "close") {
        this.panel?.dispose();
        return;
      }
      if (msg.type === "run") {
        this.handlers.onRun?.();
        return;
      }
      if (msg.type === "copy") {
        void this.copy();
        return;
      }
      if (msg.type === "refresh") {
        void this.refresh();
        return;
      }
      if (msg.type === "toggleField") {
        const path = stringPath(msg.path);
        if (path) void this.toggleField(path, msg.operation);
        return;
      }
      if (msg.type === "toggleArg" && typeof msg.name === "string") {
        const path = stringPath(msg.path);
        if (path) void this.toggleArg(path, msg.name, msg.operation);
        return;
      }
      if (msg.type === "setArg" && typeof msg.name === "string" && typeof msg.value === "string") {
        const path = stringPath(msg.path);
        if (path) void this.applyEdit({ kind: "setArg", path, name: msg.name, value: msg.value });
      }
    });
    const themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
      if (this.panel && this.payload) this.updateWebview();
    });
    this.panel.onDidDispose(() => themeListener.dispose());
  }

  private async toggleField(path: string[], operation: string | undefined): Promise<void> {
    if (
      operation &&
      this.payload &&
      operation !== this.payload.operation &&
      (operation === "query" || operation === "mutation" || operation === "subscription")
    ) {
      const switched = await this.applyEdit({ kind: "setOperation", operation });
      if (!switched) return;
    }
    await this.applyEdit({ kind: "toggleField", path });
  }

  private async toggleArg(
    path: string[],
    name: string,
    operation: string | undefined,
  ): Promise<void> {
    if (
      operation &&
      this.payload &&
      operation !== this.payload.operation &&
      (operation === "query" || operation === "mutation" || operation === "subscription")
    ) {
      const switched = await this.applyEdit({ kind: "setOperation", operation });
      if (!switched) return;
    }
    await this.applyEdit({ kind: "toggleArg", path, name });
  }

  private async applyEdit(edit: GraphQLExplorerEdit): Promise<boolean> {
    const parent = this.liveContext();
    if (!parent || !this.payload) return false;
    if (this.payload.patchable === false) {
      void vscode.window.showWarningMessage(
        this.payload.reason ?? "GraphQL body cannot be patched.",
      );
      return false;
    }
    const { result, err } = await this.bridge.graphqlExplorerPatch({
      content: parent.content,
      filepath: parent.filepath,
      line: parent.line,
      column: parent.column,
      env: parent.env,
      cwd: parent.cwd,
      edit,
    });
    if (!result?.ok) {
      const message = !result ? err : result.error;
      void vscode.window.showErrorMessage(message ?? "Failed to patch GraphQL body.");
      return false;
    }
    if (result.patchable === false) {
      this.payload = {
        ...this.payload,
        patchable: false,
        reason: result.reason,
        operation: result.operation,
        query: result.query,
        body: result.body,
        checkedFields: result.checkedFields,
        checkedArgs: result.checkedArgs,
        argValues: result.argValues,
      };
      this.updateWebview();
      void vscode.window.showWarningMessage(result.reason ?? "GraphQL body cannot be patched.");
      return false;
    }
    const wrote = await this.writeBody(result);
    if (!wrote) return false;
    this.payload = {
      ...this.payload,
      patchable: true,
      reason: undefined,
      operation: result.operation,
      query: result.query,
      variables: result.variables,
      body: result.body,
      bodyRange: result.bodyRange,
      checkedFields: result.checkedFields,
      checkedArgs: result.checkedArgs,
      argValues: result.argValues,
    };
    this.updateWebview();
    return true;
  }

  private async writeBody(
    result: Extract<GraphQLExplorerPatchResult, { ok: true }>,
  ): Promise<boolean> {
    const range = result.bodyRange;
    const parent = this.parentCtx;
    if (!range || !parent?.filepath) return false;
    const uri = vscode.Uri.file(parent.filepath);
    const document = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.fsPath === parent.filepath,
    );
    if (!document) return false;
    let text = result.body ?? "";
    if (range.leadingBlank) text = `\n${text}`;
    const start = new vscode.Position(Math.max(0, range.startLine - 1), 0);
    let end: vscode.Position;
    const inserting = range.insert || range.endLine < range.startLine;
    if (inserting) {
      end = start;
      if (!text.endsWith("\n")) text += "\n";
    } else {
      const endIndex = range.endLine - 1;
      if (endIndex >= document.lineCount - 1) {
        end = document.lineAt(document.lineCount - 1).range.end;
      } else {
        end = document.lineAt(endIndex).rangeIncludingLineBreak.end;
        if (!text.endsWith("\n")) text += "\n";
      }
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(start, end), text);
    this.applying = true;
    try {
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        void vscode.window.showErrorMessage("Failed to update the GraphQL request body.");
      }
      return applied;
    } finally {
      setTimeout(() => {
        this.applying = false;
      }, 50);
    }
  }

  private async copy(): Promise<void> {
    const parent = this.liveContext();
    if (!parent) return;
    const { result, err } = await this.bridge.graphqlExplorerToHttp({
      content: parent.content,
      filepath: parent.filepath,
      line: parent.line,
      column: parent.column,
      cwd: parent.cwd,
    });
    if (!result?.ok) {
      void vscode.window.showErrorMessage(
        (!result ? err : result.error) ?? "Failed to copy GraphQL request.",
      );
      return;
    }
    await vscode.env.clipboard.writeText(result.content);
    void vscode.window.showInformationMessage("Copied HTTP request to clipboard.");
  }

  private async refresh(): Promise<void> {
    const cacheKey = this.payload?.cacheKey;
    const parent = this.liveContext();
    if (cacheKey) {
      const cleared = await this.bridge.clearGraphqlSchema(cacheKey, parent?.cwd);
      if (cleared.err) {
        void vscode.window.showErrorMessage(cleared.err);
        return;
      }
    }
    await this.reload();
  }

  private async reload(): Promise<void> {
    const parent = this.liveContext();
    if (!parent || !this.panel) return;
    const { result } = await this.bridge.graphqlExplorerLoad({
      content: parent.content,
      filepath: parent.filepath,
      line: parent.line,
      column: parent.column,
      env: parent.env,
      cwd: parent.cwd,
    });
    if (!result?.ok) return;
    this.payload = result.graphql;
    await this.rewriteLoaded(result.graphql);
    this.updateWebview();
  }

  private async rewriteLoaded(payload: GraphQLExplorerPayload): Promise<void> {
    if (payload.rewritten !== true || payload.patchable === false || !payload.bodyRange) return;
    await this.writeBody({
      ok: true,
      patchable: true,
      operation: payload.operation,
      query: payload.query,
      variables: payload.variables,
      body: payload.body,
      bodyRange: payload.bodyRange,
      checkedFields: payload.checkedFields,
      checkedArgs: payload.checkedArgs,
      argValues: payload.argValues,
    });
  }

  private updateWebview(): void {
    if (!this.panel || !this.payload) return;
    const state: GraphQLViewState = { theme: vscodeTheme(), ...viewState(this.payload) };
    this.panel.title = "GraphQL";
    const webview = this.panel.webview;
    if (!this.webviewHtmlReady) {
      this.panel.webview.html = renderGraphqlWebview(this.context.extensionUri, webview, state);
      this.webviewHtmlReady = true;
      return;
    }
    postGraphqlState(webview, state);
  }
}

import * as vscode from "vscode";
import type { HttpStreamEvent, KulalaCoreBridge } from "./core/bridge";
import type { KulalaRequestResult, KulalaRunLimit } from "./core/types";
import { getSelectedEnv, responseViewColumnAfterOpenapi } from "./config";
import type { DocumentContext } from "./document";
import { GraphQLPanel } from "./graphql/panel";
import { OpenAPIPanel } from "./openapi/panel";
import { formatBodyDisplay } from "./response/body";
import { ResponsePanel } from "./response/panel";
import { WebSocketSession } from "./websocket/session";

const MAX_PROMPT_DEPTH = 7;

function isPrompt(item: KulalaRequestResult | undefined): boolean {
  if (!item) return false;
  if (item.prompt === true) return true;
  return Boolean(item.promptId && item.promptType);
}

function findFirstPrompt(data: KulalaRequestResult[]): KulalaRequestResult | undefined {
  return data.find((item) => isPrompt(item));
}

function completedBeforePrompt(data: KulalaRequestResult[]): KulalaRequestResult[] {
  const promptIndex = data.findIndex((item) => isPrompt(item));
  if (promptIndex <= 0) {
    return [];
  }
  return data.slice(0, promptIndex);
}

function promptBlockName(item: KulalaRequestResult): string | undefined {
  const name = item.blockName?.trim();
  return name || undefined;
}

async function collectPromptInputs(
  prompt: KulalaRequestResult,
): Promise<Array<{ id: string; value: string }> | undefined> {
  const specs = prompt.inputs ?? [];
  if (!specs.length) {
    void vscode.window.showWarningMessage("Kulala prompt has no inputs.");
    return undefined;
  }
  const out: Array<{ id: string; value: string }> = [];
  for (const inp of specs) {
    const id = inp.id;
    if (!id) return undefined;
    const label = inp.label ?? id;
    const isPassword = inp.type === "password";
    const value = await vscode.window.showInputBox({
      title: prompt.message ?? "Kulala",
      prompt: label,
      password: isPassword,
      ignoreFocusOut: true,
    });
    if (value === undefined) return undefined;
    if (inp.required && !value.trim()) {
      void vscode.window.showWarningMessage(`Required: ${label}`);
      return undefined;
    }
    out.push({ id, value });
  }
  return out;
}

export class RequestRunner {
  private running = false;
  private wsSession: WebSocketSession | undefined;
  private wsEntryId: string | undefined;
  private streamEntryIds = new Map<string, string>();
  private lastCtx: DocumentContext | undefined;

  constructor(
    private readonly bridge: KulalaCoreBridge,
    private readonly context: vscode.ExtensionContext,
    private readonly panel: ResponsePanel,
    private readonly openapiPanel: OpenAPIPanel,
    private readonly graphqlPanel: GraphQLPanel,
  ) {
    this.panel.setHandlers({
      onApplyJqFilter: (filter, entryId) => {
        void this.applyJqFilter(filter, entryId);
      },
      onSendWsMessage: (message, entryId) => {
        if (entryId !== this.wsEntryId || !this.wsSession) return;
        this.wsSession.send(message);
      },
      onCloseWebSocket: (entryId) => {
        if (entryId !== this.wsEntryId) return;
        this.closeWebSocket();
      },
    });
    this.openapiPanel.setHandlers({
      onRunOperation: (operationKey, parameterOverrides) => {
        void this.runOpenApiOperation(operationKey, parameterOverrides);
      },
      onCopyAsHttp: (operationKey, parameterOverrides) => {
        void this.copyOpenApiAsHttp(operationKey, parameterOverrides);
      },
    });
    this.graphqlPanel.setHandlers({
      onRun: () => {
        void this.runGraphQLQuery();
      },
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  async runAtCursor(ctx: DocumentContext): Promise<void> {
    const limit: KulalaRunLimit[] = [
      { filter: "cursorPosition", line: ctx.line, column: ctx.column },
    ];
    return this.run(ctx, limit);
  }

  async runAll(ctx: DocumentContext): Promise<void> {
    return this.run(ctx, undefined);
  }

  async applyJqFilter(filter: string, entryId?: string): Promise<void> {
    const active = this.panel.getActiveEntry();
    const targetId = entryId ?? active?.id;
    if (!targetId) return;

    if (this.wsSession && this.wsEntryId === targetId) {
      this.wsSession.setFilter(filter.trim() || undefined);
      return;
    }

    const entry = this.panel.getEntryById(targetId) ?? active;
    const rawBody = entry?.rawBody;
    if (!rawBody) {
      void vscode.window.showWarningMessage("No response body available to filter.");
      return;
    }

    const trimmed = filter.trim();
    const contentType = entry?.contentType ?? "application/json";
    const cwd = this.lastCtx?.cwd;

    if (!trimmed) {
      const { result } = await this.bridge.applyJqFilter(rawBody, ".", contentType, cwd);
      if (result?.filteredBody) {
        const display = formatBodyDisplay(result.filteredBody);
        this.panel.updateEntry(targetId, {
          ...displayFields(display),
          jqFilter: undefined,
        });
      }
      return;
    }

    const { result, err } = await this.bridge.applyJqFilter(rawBody, trimmed, contentType, cwd);
    if (!result?.filteredBody) {
      void vscode.window.showErrorMessage(err ?? "jq filter failed");
      return;
    }
    const display = formatBodyDisplay(result.filteredBody);
    this.panel.updateEntry(targetId, {
      ...displayFields(display),
      jqFilter: trimmed,
    });
  }

  async promptJqFilter(): Promise<void> {
    const entry = this.panel.getActiveEntry();
    if (!entry) {
      void vscode.window.showInformationMessage("No Kulala response to filter.");
      return;
    }
    const filter = await vscode.window.showInputBox({
      title: "Kulala JQ Filter",
      prompt: "Enter a jq expression (empty to clear)",
      value: entry.jqFilter ?? "",
      ignoreFocusOut: true,
    });
    if (filter === undefined) return;
    await this.applyJqFilter(filter, entry.id);
  }

  private async run(ctx: DocumentContext, limit: KulalaRunLimit[] | undefined): Promise<void> {
    if (this.running) {
      void vscode.window.showWarningMessage("A Kulala request is already running.");
      return;
    }
    this.running = true;
    this.lastCtx = ctx;
    await vscode.commands.executeCommand("setContext", "kulala.requestRunning", true);

    try {
      const folder = ctx.filepath
        ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(ctx.filepath))
        : undefined;
      const env = getSelectedEnv(this.context, folder ?? undefined);
      await this.runWithRetry(ctx, env, limit, 0);
    } finally {
      this.running = false;
      await vscode.commands.executeCommand("setContext", "kulala.requestRunning", false);
    }
  }

  private async runWithRetry(
    ctx: DocumentContext,
    env: string,
    limit: KulalaRunLimit[] | undefined,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_PROMPT_DEPTH) {
      void vscode.window.showErrorMessage("Kulala: exceeded prompt / retry limit.");
      return;
    }

    const { wrapper, err } = await this.bridge.run(ctx.content, {
      filepath: ctx.filepath,
      env,
      limit,
      cwd: ctx.cwd,
      onHttpStream: (event) => this.onHttpStream(event),
    });

    if (err) {
      this.panel.show(ResponsePanel.fromBridgeError(err));
      return;
    }

    if (wrapper?.type === "error") {
      const msg = wrapper.data?.[0]?.error ?? "kulala-core error";
      this.panel.show(ResponsePanel.fromResult({ success: false, error: msg }));
      return;
    }

    const data = wrapper?.data ?? [];
    if (data.length === 0) {
      void vscode.window.showErrorMessage("Kulala: no result from kulala-core.");
      return;
    }

    const promptItem = findFirstPrompt(data);
    if (promptItem) {
      const completedBefore = completedBeforePrompt(data);
      for (const item of completedBefore) {
        await this.deliverItem(item, ctx);
      }

      const inputs = await collectPromptInputs(promptItem);
      if (!inputs || !promptItem.promptId) {
        void vscode.window.showWarningMessage("Prompt cancelled or incomplete.");
        return;
      }

      const cont = await this.bridge.continue(promptItem.promptId, inputs, ctx.cwd);
      if (cont.err) {
        this.panel.show(ResponsePanel.fromResult({ success: false, error: cont.err }));
        return;
      }

      const contFirst = cont.wrapper?.data?.[0];
      if (!contFirst?.success) {
        this.panel.show(
          ResponsePanel.fromResult({
            success: false,
            error: contFirst?.error ?? "continue did not succeed",
          }),
        );
        return;
      }

      const blockName = promptBlockName(promptItem);
      const retryLimit: KulalaRunLimit[] | undefined =
        completedBefore.length > 0 && blockName ? [{ filter: "name", name: blockName }] : limit;

      return this.runWithRetry(ctx, env, retryLimit, depth + 1);
    }

    for (const item of data) {
      await this.deliverItem(item, ctx);
    }
  }

  private responseColumnAfterOpenapi(): vscode.ViewColumn | undefined {
    return this.openapiPanel.isOpen() || this.graphqlPanel.isOpen()
      ? responseViewColumnAfterOpenapi()
      : undefined;
  }

  private showResponse(
    state: ReturnType<typeof ResponsePanel.fromResult>,
    afterOpenapi = false,
  ): void {
    const viewColumn = afterOpenapi ? this.responseColumnAfterOpenapi() : undefined;
    this.panel.show(state, viewColumn ? { viewColumn } : undefined);
  }

  private async deliverItem(
    item: KulalaRequestResult,
    ctx: DocumentContext,
    opts?: { afterOpenapi?: boolean },
  ): Promise<void> {
    if (item.openapiUi && item.openapi) {
      const folder = ctx.filepath
        ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(ctx.filepath))
        : undefined;
      const env = getSelectedEnv(this.context, folder ?? undefined);
      this.openapiPanel.show(item.openapi, { ...ctx, env });
      return;
    }
    if (item.graphqlUi && item.graphql) {
      const folder = ctx.filepath
        ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(ctx.filepath))
        : undefined;
      const env = getSelectedEnv(this.context, folder ?? undefined);
      this.graphqlPanel.show(item.graphql, { ...ctx, env });
      return;
    }
    if (item.protocol === "websocket") {
      await this.startWebSocket(item, ctx);
      return;
    }
    const streamKey = item.blockName?.trim() || "";
    const streamId = this.streamEntryIds.get(streamKey);
    if (streamId) {
      this.streamEntryIds.delete(streamKey);
      const state = ResponsePanel.fromResult(item);
      this.panel.replaceEntry(streamId, state);
      return;
    }
    this.showResponse(ResponsePanel.fromResult(item), opts?.afterOpenapi === true);
  }

  private onHttpStream(event: HttpStreamEvent): void {
    const key = event.blockName?.trim() || "";
    if (event.event === "headers") {
      const id = this.panel.beginHttpStream({
        status: event.status,
        url: event.url,
        headers: event.headers,
        blockName: event.blockName,
      });
      this.streamEntryIds.set(key, id);
      return;
    }
    const id = this.streamEntryIds.get(key);
    if (!id) return;
    if (event.event === "chunk") {
      const current = this.panel.getEntryById(id);
      const data = event.data ?? "";
      if (!data) return;
      const body = `${current?.body ?? ""}${data}`;
      this.panel.updateEntry(id, { body, rawBody: body, bodyKind: "text" });
      return;
    }
    if (event.event === "error") {
      this.panel.updateEntry(id, {
        error: event.error ?? "stream failed",
        status: "Error",
        statusBadgeClass: "kulala-badge-error",
      });
    }
  }

  async openGraphqlExplorer(ctx: DocumentContext): Promise<void> {
    this.lastCtx = ctx;
    const folder = ctx.filepath
      ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(ctx.filepath))
      : undefined;
    const env = getSelectedEnv(this.context, folder ?? undefined);
    const { result, err } = await this.bridge.graphqlExplorerLoad({
      content: ctx.content,
      filepath: ctx.filepath,
      line: ctx.line,
      column: ctx.column,
      env,
      cwd: ctx.cwd,
    });
    if (!result?.ok) {
      void vscode.window.showErrorMessage(
        (!result ? err : result.error) ?? "Failed to load GraphQL explorer.",
      );
      return;
    }
    this.graphqlPanel.show(result.graphql, { ...ctx, env });
  }

  async runGraphQLQuery(): Promise<void> {
    const parent = this.graphqlPanel.getParentContext();
    if (!parent) {
      void vscode.window.showWarningMessage("No GraphQL parent request context.");
      return;
    }
    if (this.running) {
      void vscode.window.showWarningMessage("A Kulala request is already running.");
      return;
    }
    this.running = true;
    this.lastCtx = parent;
    await vscode.commands.executeCommand("setContext", "kulala.requestRunning", true);
    try {
      const { result, err } = await this.bridge.graphqlExplorerRun({
        content: parent.content,
        filepath: parent.filepath,
        line: parent.line,
        column: parent.column,
        env: parent.env,
        cwd: parent.cwd,
      });
      if (!result) {
        this.showResponse(ResponsePanel.fromBridgeError(err ?? "GraphQL query failed"), true);
        return;
      }
      await this.deliverItem(result, parent, { afterOpenapi: true });
    } finally {
      this.running = false;
      await vscode.commands.executeCommand("setContext", "kulala.requestRunning", false);
    }
  }

  async openOpenapiExplorer(ctx: DocumentContext): Promise<void> {
    this.lastCtx = ctx;
    const folder = ctx.filepath
      ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(ctx.filepath))
      : undefined;
    const env = getSelectedEnv(this.context, folder ?? undefined);
    const { result, err } = await this.bridge.openapiLoad({
      content: ctx.content,
      filepath: ctx.filepath,
      line: ctx.line,
      column: ctx.column,
      env,
      cwd: ctx.cwd,
    });
    if (!result?.ok || !result.openapi) {
      const loadError = !result ? err : result.ok === false ? result.error : err;
      if (this.openapiPanel.revealLast()) {
        void vscode.window.showWarningMessage(
          loadError ?? "No OpenAPI block at cursor; showing last explorer.",
        );
        return;
      }
      void vscode.window.showErrorMessage(loadError ?? "Failed to load OpenAPI explorer.");
      return;
    }
    this.openapiPanel.show(result.openapi, { ...ctx, env });
  }

  async copyLastOpenApiAsHttp(): Promise<void> {
    const operationKey = this.openapiPanel.getLastOperationKey();
    if (!operationKey) {
      void vscode.window.showWarningMessage("Select an OpenAPI operation to copy as HTTP.");
      return;
    }
    await this.copyOpenApiAsHttp(operationKey, this.openapiPanel.getOverrides(operationKey));
  }

  async copyOpenApiAsHttp(
    operationKey: string,
    parameterOverrides: Record<string, string>,
  ): Promise<void> {
    const parent = this.openapiPanel.getParentContext();
    if (!parent) {
      void vscode.window.showWarningMessage("No OpenAPI parent request context.");
      return;
    }
    const { result, err } = await this.bridge.openapiToHttp({
      content: parent.content,
      filepath: parent.filepath,
      line: parent.line,
      column: parent.column,
      env: parent.env,
      operationKey,
      parameterOverrides,
      cwd: parent.cwd,
    });
    if (!result?.ok) {
      void vscode.window.showErrorMessage(
        (!result ? err : result.error) ?? "Failed to convert OpenAPI operation to HTTP.",
      );
      return;
    }
    await vscode.env.clipboard.writeText(result.content);
    void vscode.window.showInformationMessage("Copied HTTP request to clipboard.");
  }

  async runOpenApiOperation(
    operationKey: string,
    parameterOverrides: Record<string, string>,
  ): Promise<void> {
    const parent = this.openapiPanel.getParentContext();
    if (!parent) {
      void vscode.window.showWarningMessage("No OpenAPI parent request context.");
      return;
    }
    if (this.running) {
      void vscode.window.showWarningMessage("A Kulala request is already running.");
      return;
    }

    this.running = true;
    this.lastCtx = parent;
    await vscode.commands.executeCommand("setContext", "kulala.requestRunning", true);
    try {
      const { result, err } = await this.bridge.openapiRunOperation({
        content: parent.content,
        filepath: parent.filepath,
        line: parent.line,
        column: parent.column,
        env: parent.env,
        operationKey,
        parameterOverrides,
        cwd: parent.cwd,
      });
      if (!result) {
        this.showResponse(ResponsePanel.fromBridgeError(err ?? "OpenAPI operation failed"), true);
        return;
      }
      if (isPrompt(result)) {
        const inputs = await collectPromptInputs(result);
        if (!inputs || !result.promptId) {
          void vscode.window.showWarningMessage("Prompt cancelled or incomplete.");
          return;
        }
        const cont = await this.bridge.continue(result.promptId, inputs, parent.cwd);
        if (cont.err) {
          this.showResponse(ResponsePanel.fromResult({ success: false, error: cont.err }), true);
          return;
        }
        const contFirst = cont.wrapper?.data?.[0];
        if (!contFirst) {
          this.showResponse(
            ResponsePanel.fromResult({
              success: false,
              error: "continue did not succeed",
            }),
            true,
          );
          return;
        }
        await this.deliverItem(contFirst, parent, { afterOpenapi: true });
        return;
      }
      await this.deliverItem(result, parent, { afterOpenapi: true });
    } finally {
      this.running = false;
      await vscode.commands.executeCommand("setContext", "kulala.requestRunning", false);
    }
  }

  private async startWebSocket(item: KulalaRequestResult, ctx: DocumentContext): Promise<void> {
    this.closeWebSocket();

    const state = ResponsePanel.fromResult(item, undefined, {
      wsConnected: false,
      wsClosed: false,
      rawBody: "",
    });
    this.panel.show(state);
    this.wsEntryId = state.id;

    this.wsSession = new WebSocketSession(this.bridge, item, ctx.cwd, {
      onUpdate: (wsState) => {
        if (!this.wsEntryId) return;
        this.panel.updateEntry(this.wsEntryId, {
          ...displayFields(wsState.body),
          jqFilter: wsState.jqFilter,
          rawBody: this.wsSession?.getRawBody(),
          wsConnected: wsState.connected,
          wsClosed: wsState.closed,
          error: wsState.error,
        });
      },
    });

    await this.wsSession.connect();
  }

  closeWebSocket(): void {
    if (this.wsSession) {
      this.wsSession.close();
      this.wsSession = undefined;
    }
    if (this.wsEntryId) {
      this.panel.updateEntry(this.wsEntryId, { wsConnected: false, wsClosed: true });
      this.wsEntryId = undefined;
    }
  }

  cancel(): void {
    this.closeWebSocket();
    if (this.bridge.cancelActive()) {
      void vscode.window.showInformationMessage("Kulala request cancelled.");
    }
  }
}

function displayFields(
  display: ReturnType<typeof formatBodyDisplay>,
): Pick<
  import("./response/panel").ResponseViewState,
  "body" | "bodyKind" | "bodyHtml" | "bodyImageSrc" | "binaryNote"
> {
  return {
    body: display.text,
    bodyKind: display.kind,
    bodyHtml: display.html,
    bodyImageSrc: display.imageSrc,
    binaryNote: display.binaryNote,
  };
}

import * as vscode from "vscode";
import type { ResponseViewState, TabId } from "../../shared/response-view";
import { responseViewColumn } from "../config";
import type { KulalaRequestResult } from "../core/types";
import {
  formatBodyDisplay,
  formatTimings,
  headersText,
  preferredResponseBody,
  type BodyDisplay,
  type BodyKind,
} from "./body";
import {
  badgeClass,
  consoleLevelClass,
  consoleRows,
  headerRows,
  prettyMs,
  statusBadge,
  timingRows,
  totalDurationMs,
} from "./format";
import { postWebviewState, renderResponseWebview, webviewDistUri } from "./webview-html";
import { testGroupViews } from "./tests";
import { emptyVerbose, verboseResponseBodyFromEntry, verboseView } from "./verbose";

export type { ResponseViewState, TabId };

const MAX_HISTORY = 100;

export type PanelHandlers = {
  onApplyJqFilter?: (filter: string, entryId: string) => void;
  onSendWsMessage?: (message: string, entryId: string) => void;
  onCloseWebSocket?: (entryId: string) => void;
};

/** Skip auto-generated names like `REQUEST_001` when there is no `###` title. */
function displayBlockName(blockName?: string): string | undefined {
  const name = blockName?.trim();
  if (!name || /^REQUEST_\d+$/i.test(name)) {
    return undefined;
  }
  return name;
}

function buildPanelTitle(item: KulalaRequestResult, error?: string): string {
  const method = item.request?.method ?? "?";
  const status = error
    ? "Error"
    : item.protocol === "websocket"
      ? "WebSocket"
      : item.skipped && item.success
        ? "Skipped"
        : item.aborted
          ? "Aborted"
          : String(item.status ?? (item.success ? "OK" : "Failed"));
  const summary = `${method} ${status}`;
  const name = displayBlockName(item.blockName);
  const prefix = "Kulala Result:";
  return name ? `${prefix} ${name} · ${summary}` : `${prefix} ${summary}`;
}

function panelIconPath(context: vscode.ExtensionContext): { light: vscode.Uri; dark: vscode.Uri } {
  const logo = vscode.Uri.joinPath(context.extensionUri, "images", "logo.png");
  return { light: logo, dark: logo };
}

function vscodeTheme(): "light" | "dark" {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? "light"
    : "dark";
}

function newEntryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function bodyFieldsFromDisplay(
  display: BodyDisplay,
): Pick<ResponseViewState, "body" | "bodyKind" | "bodyHtml" | "bodyImageSrc" | "binaryNote"> {
  return {
    body: display.text,
    bodyKind: display.kind as BodyKind,
    bodyHtml: display.html,
    bodyImageSrc: display.imageSrc,
    binaryNote: display.binaryNote,
  };
}

function contentTypeFromBody(item: KulalaRequestResult): string | undefined {
  const body = preferredResponseBody(item) ?? item.body;
  if (!body) return undefined;
  if (body.type === "json") return "application/json";
  return body.mediaType ?? "text/plain";
}

function isFileTab(tab: vscode.Tab): tab is vscode.Tab & { input: vscode.TabInputText } {
  return tab.input instanceof vscode.TabInputText;
}

export class ResponsePanel {
  private panel: vscode.WebviewPanel | undefined;
  private last: ResponseViewState | undefined;
  private history: ResponseViewState[] = [];
  private historyIndex = -1;
  private activeTab: TabId = "body";
  private handlers: PanelHandlers = {};
  private webviewHtmlReady = false;
  private viewColumn: vscode.ViewColumn | undefined;
  private relocating = false;
  private relocateQueued = false;
  private resultsGroupLocked = false;
  private pendingTabs: vscode.Tab[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        this.scheduleKeepResultsOnTheRight(event.opened);
      }),
    );
  }

  setHandlers(handlers: PanelHandlers): void {
    this.handlers = handlers;
  }

  show(state: ResponseViewState, opts?: { viewColumn?: vscode.ViewColumn }): void {
    this.viewColumn = opts?.viewColumn;
    this.pushHistory(state);
    this.last = state;
    this.ensurePanel();
    this.updateWebview();
  }

  beginHttpStream(event: {
    status?: number;
    url?: string;
    headers?: Record<string, string>;
    blockName?: string;
  }): string {
    const id = newEntryId();
    const badge = statusBadge(event.status);
    const rows = headerRows(event.headers);
    this.show({
      id,
      at: Date.now(),
      title: `Kulala Result: ${event.status ?? "Streaming"}`,
      blockName: displayBlockName(event.blockName),
      status: event.status ?? "Streaming",
      statusBadgeClass: badgeClass(badge),
      url: event.url,
      body: "",
      bodyKind: "text",
      rawBody: "",
      headers: rows.map((row) => `${row.name}: ${row.value}`).join("\n"),
      headersRows: rows,
      stats: "",
      timingRows: [],
      console: "",
      consoleLines: [],
      testGroups: [],
      verbose: emptyVerbose,
    });
    return id;
  }

  replaceEntry(id: string, state: ResponseViewState): void {
    const idx = this.history.findIndex((entry) => entry.id === id);
    if (idx < 0) {
      this.show({ ...state, id });
      return;
    }
    const next = { ...state, id };
    this.history[idx] = next;
    if (this.historyIndex === idx) {
      this.last = next;
      if (this.panel) this.panel.title = next.title;
    }
    this.updateWebview();
  }

  updateEntry(id: string, patch: Partial<ResponseViewState>): void {
    const idx = this.history.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const current = this.history[idx];
    const merged = { ...current, ...patch };
    if (
      current.isWebSocket &&
      (patch.body !== undefined || patch.bodyKind !== undefined || patch.bodyHtml !== undefined)
    ) {
      merged.verbose = {
        ...merged.verbose,
        responseBody: verboseResponseBodyFromEntry(merged),
      };
    }
    this.history[idx] = merged;
    if (this.historyIndex === idx) {
      this.last = merged;
      this.panel!.title = merged.title;
    }
    this.updateWebview();
  }

  updateBodyFromDisplay(
    id: string,
    display: BodyDisplay,
    extra?: Partial<ResponseViewState>,
  ): void {
    this.updateEntry(id, { ...bodyFieldsFromDisplay(display), ...extra });
  }

  getActiveEntry(): ResponseViewState | undefined {
    if (this.history.length === 0) return undefined;
    const index = Math.max(0, Math.min(this.historyIndex, this.history.length - 1));
    return this.history[index];
  }

  getEntryById(id: string): ResponseViewState | undefined {
    return this.history.find((e) => e.id === id);
  }

  revealLast(): void {
    if (this.history.length > 0) {
      this.ensurePanel();
      this.updateWebview();
      return;
    }
    if (this.last) {
      this.show(this.last);
      return;
    }
    void vscode.window.showInformationMessage("No Kulala response yet. Send a request first.");
  }

  clearHistory(): void {
    this.history = [];
    this.historyIndex = -1;
    if (this.panel) {
      this.updateWebview();
    }
  }

  static fromBridgeError(error: string): ResponseViewState {
    return {
      id: newEntryId(),
      at: Date.now(),
      title: "Kulala Result: Error",
      status: "Error",
      statusBadgeClass: badgeClass("error"),
      error,
      body: "",
      bodyKind: "text",
      headers: "",
      headersRows: [],
      stats: "",
      timingRows: [],
      console: "",
      consoleLines: [],
      testGroups: [],
      verbose: emptyVerbose,
    };
  }

  static fromResult(
    item: KulalaRequestResult,
    error?: string,
    overrides?: Partial<ResponseViewState>,
  ): ResponseViewState {
    const method = item.request?.method ?? "?";
    const status = error
      ? "Error"
      : item.protocol === "websocket"
        ? "WebSocket"
        : item.skipped && item.success
          ? "Skipped"
          : item.aborted
            ? "Aborted"
            : (item.status ?? (item.success ? "OK" : "Failed"));
    const blockName = displayBlockName(item.blockName);
    const badge = statusBadge(
      error
        ? "Error"
        : item.protocol === "websocket"
          ? "WebSocket"
          : item.skipped && item.success
            ? "Skipped"
            : item.aborted
              ? "Aborted"
              : typeof status === "number"
                ? status
                : undefined,
    );
    const durationMs = totalDurationMs(item.timings);
    const rows = consoleRows(item);
    const bodyDisplay = formatBodyDisplay(preferredResponseBody(item));
    const groups = testGroupViews(item.scriptConsole);

    return {
      id: newEntryId(),
      at: Date.now(),
      title: buildPanelTitle(item, error),
      blockName,
      status,
      statusBadgeClass: badgeClass(badge),
      url: item.url ?? item.request?.url,
      method,
      durationMs,
      durationLabel: prettyMs(durationMs),
      error: error ?? (item.success ? undefined : item.error),
      ...bodyFieldsFromDisplay(bodyDisplay),
      headers: headersText(item.headers),
      headersRows: headerRows(item.headers),
      stats: formatTimings(item),
      timingRows: timingRows(item.timings),
      console: rows.map((r) => `[${r.level}] ${r.message}`).join("\n"),
      consoleLines: rows.map((r) => ({
        ...r,
        levelClass: consoleLevelClass(r.level),
      })),
      testGroups: groups,
      jqFilter: item.jqFilter,
      rawBody: item.rawBody,
      contentType: contentTypeFromBody(item),
      isWebSocket: item.protocol === "websocket",
      wsConnected: false,
      wsClosed: false,
      verbose: verboseView(item),
      ...overrides,
    };
  }

  private pushHistory(state: ResponseViewState): void {
    this.history.push(state);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
  }

  private buildPayload(): {
    theme: "light" | "dark";
    entries: ResponseViewState[];
    index: number;
    tab: TabId;
  } {
    const index =
      this.history.length === 0
        ? 0
        : Math.max(0, Math.min(this.historyIndex, this.history.length - 1));
    this.historyIndex = index;
    return {
      theme: vscodeTheme(),
      entries: this.history,
      index,
      tab: this.activeTab,
    };
  }

  private resultsAreSplit(): boolean {
    return (this.viewColumn ?? responseViewColumn()) !== vscode.ViewColumn.Active;
  }

  /** Keep the results group from accepting editors, so new files stay in the group to its left. */
  private async lockResultsGroup(): Promise<void> {
    const panel = this.panel;
    if (!panel || this.resultsGroupLocked || !this.resultsAreSplit()) return;
    panel.reveal(panel.viewColumn, false);
    if (
      panel.viewColumn != null &&
      vscode.window.tabGroups.activeTabGroup.viewColumn !== panel.viewColumn
    ) {
      return;
    }
    try {
      await vscode.commands.executeCommand("workbench.action.lockEditorGroup");
      this.resultsGroupLocked = true;
    } catch {
      // The editor has no group-lock command.
    }
  }

  private scheduleKeepResultsOnTheRight(opened: readonly vscode.Tab[]): void {
    if (!this.panel || !this.resultsAreSplit() || opened.length === 0) return;
    this.pendingTabs.push(...opened);
    this.relocateQueued = true;
    if (this.relocating) return;
    void this.drainRelocate();
  }

  private async drainRelocate(): Promise<void> {
    this.relocating = true;
    try {
      while (this.relocateQueued) {
        this.relocateQueued = false;
        await this.moveFilesLeftOfResults();
      }
    } finally {
      this.relocating = false;
    }
  }

  private async moveFilesLeftOfResults(): Promise<void> {
    const panel = this.panel;
    const responseColumn = panel?.viewColumn;
    const opened = this.pendingTabs.splice(0);
    if (!panel || responseColumn == null || responseColumn <= vscode.ViewColumn.One) return;

    const destination =
      vscode.window.tabGroups.all
        .filter((group) => group.viewColumn < responseColumn)
        .sort((a, b) => a.viewColumn - b.viewColumn)[0]?.viewColumn ?? vscode.ViewColumn.One;

    const stray = opened.filter(isFileTab).filter((tab) => tab.group.viewColumn >= responseColumn);
    if (stray.length === 0) return;

    for (const tab of stray) {
      if (tab.group.viewColumn < responseColumn) continue;
      await vscode.window.showTextDocument(tab.input.uri, {
        viewColumn: destination,
        preserveFocus: true,
        preview: false,
      });
    }
    panel.reveal(panel.viewColumn, true);
  }

  private ensurePanel(): void {
    const column = this.viewColumn ?? responseViewColumn();
    if (this.panel) {
      this.panel.reveal(column);
      void this.lockResultsGroup();
      return;
    }

    this.panel = vscode.window.createWebviewPanel("kulalaResponse", "Kulala Response", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [webviewDistUri(this.context.extensionUri)],
    });
    this.panel.iconPath = panelIconPath(this.context);
    void this.lockResultsGroup();
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.webviewHtmlReady = false;
      this.resultsGroupLocked = false;
    });
    this.panel.webview.onDidReceiveMessage(
      (msg: {
        type?: string;
        index?: number;
        filter?: string;
        message?: string;
        entryId?: string;
      }) => {
        if (msg.type === "select" && typeof msg.index === "number") {
          this.historyIndex = Math.max(0, Math.min(msg.index, this.history.length - 1));
          const entry = this.history[this.historyIndex];
          if (entry) {
            this.last = entry;
            this.panel!.title = entry.title;
          }
          return;
        }
        if (msg.type === "clearHistory") {
          this.clearHistory();
          return;
        }
        const entry = msg.entryId
          ? this.history.find((e) => e.id === msg.entryId)
          : this.getActiveEntry();
        if (!entry) return;

        if (msg.type === "applyJq" && typeof msg.filter === "string") {
          this.handlers.onApplyJqFilter?.(msg.filter, entry.id);
        } else if (msg.type === "wsSend" && typeof msg.message === "string") {
          this.handlers.onSendWsMessage?.(msg.message, entry.id);
        } else if (msg.type === "wsClose") {
          this.handlers.onCloseWebSocket?.(entry.id);
        }
      },
    );

    const themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
      if (this.panel) this.updateWebview();
    });
    this.panel.onDidDispose(() => themeListener.dispose());
  }

  private updateWebview(): void {
    if (!this.panel) return;

    const payload = this.buildPayload();
    const webview = this.panel.webview;

    if (this.history.length === 0) {
      this.panel.title = "Kulala Response";
    } else {
      const entry = this.history[payload.index];
      if (entry) this.panel.title = entry.title;
    }

    if (!this.webviewHtmlReady) {
      this.panel.webview.html = renderResponseWebview(this.context.extensionUri, webview, payload);
      this.webviewHtmlReady = true;
      return;
    }

    postWebviewState(webview, payload);
  }
}

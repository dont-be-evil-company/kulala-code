import type { ResponseViewState } from "../../shared/response-view";
import type { HistoryEntry, HistorySearchMatch } from "../core/bridge";
import { badgeClass, consoleLevelClass, headerRows, statusBadge } from "./format";

function bodyKind(text: string): "json" | "text" {
  const trimmed = text.trim();
  if (!trimmed) return "text";
  try {
    JSON.parse(trimmed);
    return "json";
  } catch {
    return "text";
  }
}

/** In-memory only. Cleared when the extension host exits. */
let sessionQuery = "";

export const SEARCH_DEBOUNCE_MS = 200;

export function getSessionQuery(): string {
  return sessionQuery;
}

export function setSessionQuery(query: string): void {
  sessionQuery = query;
}

export type HistoryPickItem = {
  label: string;
  description?: string;
  alwaysShow: true;
  historyId: number;
};

/** Quick Pick items stay visible when the query is not part of the label. */
export function historyPickItems(matches: HistorySearchMatch[]): HistoryPickItem[] {
  return matches.map((match) => {
    const snippet = match.snippets?.[0];
    return {
      label: match.label,
      description: snippet ? `${snippet.field}: ${snippet.text}` : undefined,
      alwaysShow: true,
      historyId: match.id,
    };
  });
}

export function historyEntryToView(entry: HistoryEntry): ResponseViewState {
  const body = entry.responseBodyText ?? "";
  const kind = bodyKind(body);
  const status = entry.statusCode ?? "Saved";
  const headers = headerRows(entry.responseHeaders);
  const requestHeaders = headerRows(entry.requestHeaders);
  const consoleText = [entry.requestScriptsText, entry.responseScriptsText]
    .filter((line): line is string => Boolean(line && line.trim()))
    .join("\n\n");
  const parsedAt = Date.parse(entry.createdAt.replace(" ", "T"));
  return {
    id: `history:${entry.id}`,
    at: Number.isNaN(parsedAt) ? Date.now() : parsedAt,
    title: `Kulala Result: ${entry.blockName ?? entry.method} · ${status}`,
    blockName: entry.blockName ?? undefined,
    status,
    statusBadgeClass: badgeClass(statusBadge(entry.statusCode)),
    url: entry.url,
    method: entry.method,
    body,
    bodyKind: kind,
    rawBody: body,
    contentType: kind === "json" ? "application/json" : undefined,
    headers: headers.map((row) => `${row.name}: ${row.value}`).join("\n"),
    headersRows: headers,
    stats: entry.createdAt,
    timingRows: [],
    console: consoleText,
    consoleLines: consoleText
      ? [{ level: "info", message: consoleText, levelClass: consoleLevelClass("info") }]
      : [],
    testGroups: [],
    verbose: {
      requestHeadersRows: requestHeaders,
      requestBody: { body: entry.requestBodyText ?? "", bodyKind: bodyKind(entry.requestBodyText ?? "") },
      responseHeadersRows: headers,
      responseBody: { body, bodyKind: kind },
    },
  };
}

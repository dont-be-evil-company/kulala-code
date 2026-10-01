import { formatJsonSync } from "../core/bridge";
import type { KulalaRequestResult } from "../core/types";
import type { VerboseBodyView, VerboseView } from "../../shared/response-view";
import { formatBodyDisplay } from "./body";
import { headerRows } from "./format";

function bodyViewFromDisplay(display: {
  kind: "json" | "text" | "image" | "binary";
  text: string;
  html?: string;
  binaryNote?: string;
}): VerboseBodyView {
  if (display.kind === "json") {
    return { bodyKind: "json", body: display.text };
  }
  if (display.kind === "binary") {
    return { bodyKind: "text", body: display.binaryNote ?? "(binary body omitted)" };
  }
  if (display.kind === "image") {
    return { bodyKind: "text", body: "(image response - see Body tab)" };
  }
  return { bodyKind: "text", body: display.text };
}

function formatRequestBody(body: string | undefined): VerboseBodyView {
  if (!body) {
    return { bodyKind: "text", body: "" };
  }
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const text = formatJsonSync(undefined, { text: body });
    if (text) return { bodyKind: "json", body: text };
  }
  return { bodyKind: "text", body };
}

export const emptyVerbose: VerboseView = {
  requestHeadersRows: [],
  requestBody: { bodyKind: "text", body: "" },
  responseHeadersRows: [],
  responseBody: { bodyKind: "text", body: "" },
};

export function verboseView(item: KulalaRequestResult): VerboseView {
  if (!item.request && !item.headers && !item.body) {
    return emptyVerbose;
  }
  return {
    requestHeadersRows: headerRows(item.request?.headers),
    requestBody: formatRequestBody(item.request?.body),
    responseHeadersRows: headerRows(item.headers),
    responseBody: bodyViewFromDisplay(formatBodyDisplay(item.body)),
  };
}

export function verboseResponseBodyFromEntry(entry: {
  body: string;
  bodyKind: string;
  bodyHtml?: string;
  binaryNote?: string;
}): VerboseBodyView {
  if (entry.bodyKind === "json" && entry.bodyHtml) {
    return { bodyKind: "json", body: entry.body, bodyHtml: entry.bodyHtml };
  }
  if (entry.bodyKind === "binary" && entry.binaryNote) {
    return { bodyKind: "text", body: entry.binaryNote };
  }
  if (entry.bodyKind === "image") {
    return { bodyKind: "text", body: "(image response - see Body tab)" };
  }
  return { bodyKind: "text", body: entry.body };
}

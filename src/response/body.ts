import { formatJsonSync } from "../core/bridge";
import type { KulalaRequestResult, KulalaResponseBody } from "../core/types";

export type BodyKind = "json" | "text" | "image" | "binary";

export type BodyDisplay = {
  kind: BodyKind;
  text: string;
  /** Syntax-highlighted HTML when kind is json */
  html?: string;
  /** data: URI for image preview */
  imageSrc?: string;
  /** Human-readable note for omitted binary bodies */
  binaryNote?: string;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(className: string, raw: string): string {
  return `<span class="${className}">${escapeHtml(raw)}</span>`;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMediaType(mediaType?: string): boolean {
  return Boolean(mediaType?.toLowerCase().startsWith("image/"));
}

/** Token-aware highlighter for pretty-printed JSON (2-space indent from kulala-core).
 * Kept for optional host-side use; the webview Body tab uses Monaco instead.
 */
export function highlightJson(json: string): string {
  const parts: string[] = [];
  let i = 0;

  while (i < json.length) {
    const ch = json[i];

    if (ch === '"') {
      let j = i + 1;
      while (j < json.length) {
        if (json[j] === "\\") {
          j += 2;
          continue;
        }
        if (json[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      const str = json.slice(i, j);
      let k = j;
      while (k < json.length && /\s/.test(json[k])) k++;
      const isKey = json[k] === ":";
      parts.push(span(isKey ? "json-key" : "json-string", str));
      i = j;
      continue;
    }

    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      let j = i + 1;
      while (j < json.length && /[0-9.eE+-]/.test(json[j])) j++;
      parts.push(span("json-number", json.slice(i, j)));
      i = j;
      continue;
    }

    if (json.startsWith("true", i)) {
      parts.push(span("json-literal", "true"));
      i += 4;
      continue;
    }
    if (json.startsWith("false", i)) {
      parts.push(span("json-literal", "false"));
      i += 5;
      continue;
    }
    if (json.startsWith("null", i)) {
      parts.push(span("json-literal", "null"));
      i += 4;
      continue;
    }

    if ("{}[],:".includes(ch)) {
      parts.push(span("json-punctuation", ch));
      i++;
      continue;
    }

    if (/\s/.test(ch)) {
      parts.push(escapeHtml(ch));
      i++;
      continue;
    }

    parts.push(escapeHtml(ch));
    i++;
  }

  return parts.join("");
}

export function formatBodyDisplay(body: KulalaResponseBody | undefined): BodyDisplay {
  if (!body) {
    return { kind: "text", text: "" };
  }
  if (body.type === "json") {
    const text =
      body.formatted ?? formatJsonSync(body.content) ?? JSON.stringify(body.content);
    return { kind: "json", text };
  }
  if (body.type === "binary") {
    const mediaType = body.mediaType ?? "application/octet-stream";
    if (isImageMediaType(mediaType)) {
      return {
        kind: "image",
        text: "",
        imageSrc: `data:${mediaType};base64,${body.content}`,
      };
    }
    return {
      kind: "binary",
      text: "",
      binaryNote: `Binary response body (${mediaType}, ${formatByteSize(body.byteLength)})`,
    };
  }
  return { kind: "text", text: body.content ?? "" };
}

export function preferredResponseBody(item: KulalaRequestResult): KulalaResponseBody | undefined {
  const preferred = item.filteredBody ?? item.body;
  if (preferred) return preferred;

  // Skip/abort (and other pre-HTTP failures): surface client.log in the body pane.
  if (
    (item.skipped && item.success) ||
    item.aborted ||
    (item.success === false && !item.httpCompleted && !item.prompt)
  ) {
    const logs = (item.scriptConsole ?? [])
      .map((l) => l.message)
      .filter((m) => typeof m === "string" && m.trim().length > 0)
      .join("\n");
    const footer =
      item.skipped && item.success
        ? (item.message ?? "Request skipped by script")
        : (item.error ?? "Request failed");
    const content = logs.length > 0 ? `${logs}\n\n${footer}` : footer;
    return { type: "text", content, mediaType: "text/plain" };
  }

  return undefined;
}

export function bodyText(body: KulalaResponseBody | undefined): string {
  return formatBodyDisplay(body).text;
}

export function headersText(headers: Record<string, string> | undefined): string {
  if (!headers) return "";
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  lines.sort();
  return `${lines.join("\n")}\n`;
}

export function formatTimings(item: KulalaRequestResult): string {
  const t = item.timings;
  if (!t) return "";
  const rows = [
    ["DNS", t.dns],
    ["TCP", t.tcp],
    ["TLS", t.tls],
    ["Request", t.request],
    ["TTFB", t.firstByte],
    ["Total", t.total],
  ];
  return rows.map(([name, ms]) => `${name}: ${Number(ms ?? 0).toFixed(1)} ms`).join("\n");
}

export function formatScriptConsole(item: KulalaRequestResult): string {
  const lines = item.scriptConsole ?? [];
  if (!lines.length) return "";
  return lines.map((l) => `[${l.level}] ${l.message}`).join("\n");
}

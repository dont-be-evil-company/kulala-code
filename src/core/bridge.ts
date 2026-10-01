import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { effectiveDataDir, timeoutMs } from "../config";
import { ensureCoreInstalled } from "./installer";
import type {
  KulalaDocument,
  KulalaEnvironmentCatalog,
  KulalaJqFilterResult,
  KulalaResponseWrapper,
  KulalaRunLimit,
  KulalaLspFiletype,
  ClearOpenAPISchemaResult,
  OpenAPILoadResult,
  OpenAPIToHttpResult,
  KulalaRequestResult,
  LspCompletionItem,
  LspCompletionList,
  LspDiagnostic,
  LspDocumentSymbol,
  LspHover,
} from "./types";

export type WebSocketConnectOptions = {
  url: string;
  body?: string;
  headers?: Record<string, string>;
  messages?: Array<{ waitForServer: number; data: string }>;
  timeoutMs?: number;
};

export type WebSocketEvent =
  | { type: "ready" }
  | { type: "message"; data: string }
  | { type: "sent"; data: string }
  | { type: "waiting"; remaining: number }
  | { type: "script-done" }
  | { type: "error"; error: string }
  | { type: "closed"; code?: number };

/** Strip Bun/Node code frames so the response panel does not show bundled source. */
export function summarizeCoreStderr(stderr: string): string {
  const text = stderr.trim();
  if (!text) return text;

  const lines = text.split(/\r?\n/);
  const useful: string[] = [];
  for (const line of lines) {
    // Bun/V8 code frames: `85793 | process.stdout.write...`
    if (/^\s*\d+\s*\|/.test(line)) continue;
    if (/^\s*\^+\s*$/.test(line)) continue;
    if (/^\s*at\s+/.test(line)) continue;
    if (/^Bun v\d/i.test(line.trim())) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    useful.push(trimmed);
  }

  // Prefer the actual exception line when present.
  const exception = useful.find((l) =>
    /^(?:Error|TypeError|SyntaxError|RangeError|URIError|ReferenceError)\b/.test(l),
  );
  if (exception) return exception;

  if (useful.length > 0) {
    return useful.slice(0, 4).join("\n");
  }

  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

export type WebSocketSessionHandle = {
  send(data: string): void;
  close(): void;
  kill(): void;
  readonly pid: number | undefined;
};

export type LspRequestOpts = {
  filepath?: string;
  cwd?: string;
  env?: string;
  filetype?: KulalaLspFiletype;
};

type CorePayload = Record<string, unknown>;

export type HttpStreamEvent = {
  type: "http-stream";
  event: "headers" | "chunk" | "error";
  status?: number;
  httpVersion?: string;
  headers?: Record<string, string>;
  url?: string;
  data?: string;
  error?: string;
  blockName?: string;
};

export function parseHttpStreamLine(line: string): HttpStreamEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const value = JSON.parse(trimmed) as HttpStreamEvent;
    if (value && value.type === "http-stream" && typeof value.event === "string") {
      return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function contentRequestsKeepAlive(payload: CorePayload): boolean {
  return (
    typeof payload.content === "string" && payload.content.includes("@kulala-keep-alive-stream")
  );
}

export type FormatJsonOptions = {
  indent?: number;
  expand_tabs?: boolean;
  sort_keys?: boolean;
  text?: string;
};

let cachedExecutable: string | undefined;

function formatJsonWithExe(
  exe: string,
  value: unknown,
  opts?: FormatJsonOptions,
): string | undefined {
  const payload: Record<string, unknown> = {
    action: "format_json",
    indent: opts?.indent,
    expand_tabs: opts?.expand_tabs,
    sort_keys: opts?.sort_keys,
  };
  if (opts?.text !== undefined) payload.text = opts.text;
  else payload.value = value;

  const result = spawnSync(exe, [], {
    input: `${JSON.stringify(payload)}\n`,
    encoding: "utf8",
    env: { ...process.env, KULALA_CORE_DATA_DIR: effectiveDataDir() },
  });
  if (result.status !== 0 || !result.stdout) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as { success?: boolean; content?: string };
    if (parsed.success === true && typeof parsed.content === "string") return parsed.content;
  } catch {
    return undefined;
  }
  return undefined;
}

/** Pretty-print JSON with the cached kulala-core binary. */
export function formatJsonSync(value: unknown, opts?: FormatJsonOptions): string | undefined {
  if (!cachedExecutable) return undefined;
  return formatJsonWithExe(cachedExecutable, value, opts);
}

export class KulalaCoreBridge {
  private active: ChildProcessWithoutNullStreams | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async executable(): Promise<string> {
    const exe = await ensureCoreInstalled(this.context);
    cachedExecutable = exe;
    return exe;
  }

  async formatJson(value: unknown, opts?: FormatJsonOptions): Promise<string | undefined> {
    const exe = await this.executable();
    return formatJsonWithExe(exe, value, opts);
  }

  cancelActive(): boolean {
    if (!this.active) {
      return false;
    }
    this.active.kill("SIGTERM");
    this.active = undefined;
    return true;
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, KULALA_CORE_DATA_DIR: effectiveDataDir() };
  }

  private invoke(
    payload: CorePayload,
    cwd?: string,
    hooks?: { onHttpStream?: (event: HttpStreamEvent) => void },
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      this.executable()
        .then((exe) => {
          const timeout = contentRequestsKeepAlive(payload) ? 0 : timeoutMs();
          const child = spawn(exe, [], {
            cwd: cwd && cwd.length > 0 ? cwd : undefined,
            env: this.env(),
            stdio: ["pipe", "pipe", "pipe"],
          });
          this.active = child;

          let stdout = "";
          let stderr = "";
          let pending = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          const takeLine = (line: string): void => {
            const event = parseHttpStreamLine(line);
            if (event) {
              hooks?.onHttpStream?.(event);
              return;
            }
            stdout += `${line}\n`;
          };
          child.stdout.on("data", (c: string) => {
            pending += c;
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) takeLine(line);
          });
          child.stderr.on("data", (c) => {
            stderr += c;
          });

          const timer =
            timeout > 0
              ? setTimeout(() => {
                  child.kill("SIGTERM");
                }, timeout)
              : undefined;

          child.on("error", (err) => {
            if (timer) clearTimeout(timer);
            this.active = undefined;
            reject(err);
          });

          child.on("close", (code) => {
            if (timer) clearTimeout(timer);
            this.active = undefined;
            if (pending) {
              const event = parseHttpStreamLine(pending);
              if (event) hooks?.onHttpStream?.(event);
              else stdout += pending;
            }
            resolve({ stdout, stderr, code: code ?? 1 });
          });

          child.stdin.write(`${JSON.stringify(payload)}\n`);
          child.stdin.end();
        })
        .catch((error: unknown) => {
          const msg = error instanceof Error ? error.message : String(error);
          resolve({ stdout: "", stderr: msg, code: 1 });
        });
    });
  }

  static tryDecodeWrapper(stdout: string): KulalaResponseWrapper | undefined {
    const raw = stdout.trim();
    if (!raw) return undefined;
    try {
      const w = JSON.parse(raw) as KulalaResponseWrapper;
      if (w && typeof w === "object" && w.type) return w;
    } catch {
      /* ignore */
    }
    return undefined;
  }

  private runResultFromJob(job: { stdout: string; stderr: string; code: number }): {
    wrapper?: KulalaResponseWrapper;
    err?: string;
  } {
    const wrapper = KulalaCoreBridge.tryDecodeWrapper(job.stdout);
    const isPrompt =
      wrapper?.type === "responses" &&
      (wrapper.data ?? []).some(
        (item) => item.prompt === true || Boolean(item.promptId && item.promptType),
      );

    if (job.code !== 0 && !isPrompt) {
      const err = summarizeCoreStderr(job.stderr) || `kulala-core failed (exit ${job.code})`;
      return { err };
    }
    if (!wrapper) {
      return { err: "invalid kulala-core output" };
    }
    return { wrapper };
  }

  async parse(
    content: string,
    filepath?: string,
    cwd?: string,
  ): Promise<{ doc?: KulalaDocument; err?: string }> {
    const payload: CorePayload = { action: "parse", content };
    if (filepath) payload.filepath = filepath;
    const job = await this.invoke(payload, cwd);
    try {
      const raw = (job.stdout || job.stderr).trim();
      const doc = JSON.parse(raw) as KulalaDocument;
      if (doc?.blocks) return { doc };
    } catch {
      /* fall through */
    }
    if (job.code !== 0) {
      return { err: job.stderr.trim() || "kulala-core parse failed" };
    }
    return { err: "invalid kulala-core parse output" };
  }

  async run(
    content: string,
    opts: {
      filepath?: string;
      env: string;
      limit?: KulalaRunLimit[];
      cwd?: string;
      onHttpStream?: (event: HttpStreamEvent) => void;
    },
  ): Promise<{ wrapper?: KulalaResponseWrapper; err?: string }> {
    const payload: CorePayload = {
      action: "run",
      content,
      env: opts.env,
    };
    if (opts.filepath) payload.filepath = opts.filepath;
    if (opts.limit?.length) payload.limit = opts.limit;
    const job = await this.invoke(payload, opts.cwd, { onHttpStream: opts.onHttpStream });
    return this.runResultFromJob(job);
  }

  async continue(
    promptId: string,
    inputs: Array<{ id: string; value: string }>,
    cwd?: string,
  ): Promise<{ wrapper?: KulalaResponseWrapper; err?: string }> {
    const job = await this.invoke({ action: "continue", promptId, inputs }, cwd);
    return this.runResultFromJob(job);
  }

  async listEnvironments(
    cwd: string,
  ): Promise<{ catalog?: KulalaEnvironmentCatalog; err?: string }> {
    const job = await this.invoke({ action: "environments", cwd }, cwd);
    const raw = job.stdout.trim();
    if (!raw) {
      return { err: job.stderr.trim() || "kulala-core environments failed" };
    }
    try {
      const catalog = JSON.parse(raw) as KulalaEnvironmentCatalog;
      if (catalog?.environments && typeof catalog.environments === "object") {
        return { catalog };
      }
    } catch {
      /* ignore */
    }
    return { err: "invalid kulala-core environments output" };
  }

  async lspCompletion(
    content: string,
    line: number,
    column: number,
    opts: LspRequestOpts = {},
  ): Promise<LspCompletionItem[]> {
    const job = await this.invoke(
      {
        action: "lsp_completion",
        content,
        filepath: opts.filepath,
        line,
        column,
        env: opts.env ?? "default",
        filetype: opts.filetype ?? "http",
      },
      opts.cwd,
    );
    try {
      const parsed = JSON.parse(job.stdout.trim()) as LspCompletionList | LspCompletionItem[];
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return parsed.items ?? [];
    } catch {
      return [];
    }
  }

  async lspHover(
    content: string,
    line: number,
    column: number,
    opts: LspRequestOpts = {},
  ): Promise<LspHover | undefined> {
    const job = await this.invoke(
      {
        action: "lsp_hover",
        content,
        filepath: opts.filepath,
        line,
        column,
        env: opts.env ?? "default",
        filetype: opts.filetype ?? "http",
      },
      opts.cwd,
    );
    const raw = job.stdout.trim();
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as LspHover;
    } catch {
      return undefined;
    }
  }

  async lspDiagnostics(content: string, opts: LspRequestOpts = {}): Promise<LspDiagnostic[]> {
    const job = await this.invoke(
      { action: "lsp_diagnostics", content, filepath: opts.filepath },
      opts.cwd,
    );
    try {
      return JSON.parse(job.stdout.trim()) as LspDiagnostic[];
    } catch {
      return [];
    }
  }

  async lspDocumentSymbols(
    content: string,
    opts: LspRequestOpts = {},
  ): Promise<LspDocumentSymbol[]> {
    const job = await this.invoke(
      { action: "lsp_symbols", content, filepath: opts.filepath },
      opts.cwd,
    );
    try {
      return JSON.parse(job.stdout.trim()) as LspDocumentSymbol[];
    } catch {
      return [];
    }
  }

  async toCurl(
    content: string,
    filepath: string | undefined,
    line: number,
    column: number,
    cwd?: string,
  ): Promise<string | undefined> {
    const job = await this.invoke({ action: "to_curl", content, filepath, line, column }, cwd);
    const raw = job.stdout.trim();
    if (!raw) return undefined;
    try {
      const result = JSON.parse(raw) as { ok?: boolean; curl?: string };
      if (result.ok && typeof result.curl === "string") return result.curl;
    } catch {
      return raw;
    }
    return undefined;
  }

  async fromCurl(curl: string, cwd?: string): Promise<string | undefined> {
    const job = await this.invoke({ action: "from_curl", curl }, cwd);
    const raw = job.stdout.trim();
    if (!raw) return undefined;
    try {
      const result = JSON.parse(raw) as { ok?: boolean; lines?: string[] };
      if (result.ok && Array.isArray(result.lines)) return result.lines.join("\n");
    } catch {
      return raw;
    }
    return undefined;
  }

  async inspectRequest(
    content: string,
    filepath: string | undefined,
    line: number,
    column: number,
    env: string,
    cwd?: string,
  ): Promise<string | undefined> {
    const job = await this.invoke(
      { action: "inspect_request", content, filepath, line, column, env },
      cwd,
    );
    const raw = job.stdout.trim();
    if (!raw) return undefined;
    try {
      const result = JSON.parse(raw) as { ok?: boolean; lines?: string[] };
      if (result.ok && Array.isArray(result.lines)) return result.lines.join("\n");
    } catch {
      return raw;
    }
    return undefined;
  }

  async clearGlobals(cwd?: string): Promise<void> {
    await this.invoke({ action: "clear_globals" }, cwd);
  }

  async openapiLoad(opts: {
    content: string;
    filepath?: string;
    line: number;
    column: number;
    env?: string;
    cwd?: string;
  }): Promise<{ result?: OpenAPILoadResult; err?: string }> {
    const job = await this.invoke(
      {
        action: "openapi_load",
        content: opts.content,
        filepath: opts.filepath,
        line: opts.line,
        column: opts.column,
        env: opts.env ?? "default",
      },
      opts.cwd,
    );
    const raw = job.stdout.trim();
    if (!raw) {
      return { err: job.stderr.trim() || "kulala-core openapi_load failed" };
    }
    try {
      const result = JSON.parse(raw) as OpenAPILoadResult & { type?: string };
      if (result.ok === true && result.openapi) return { result };
      if (result.ok === false) return { result };
      return { err: "invalid kulala-core openapi_load output" };
    } catch {
      return { err: "invalid kulala-core openapi_load output" };
    }
  }

  async openapiRunOperation(opts: {
    content: string;
    filepath?: string;
    line: number;
    column: number;
    env?: string;
    operationKey: string;
    parameterOverrides?: Record<string, string>;
    cwd?: string;
  }): Promise<{ result?: KulalaRequestResult; err?: string }> {
    const job = await this.invoke(
      {
        action: "openapi_run_operation",
        content: opts.content,
        filepath: opts.filepath,
        line: opts.line,
        column: opts.column,
        env: opts.env ?? "default",
        operationKey: opts.operationKey,
        ...(opts.parameterOverrides && Object.keys(opts.parameterOverrides).length > 0
          ? { parameterOverrides: opts.parameterOverrides }
          : {}),
      },
      opts.cwd,
    );
    const raw = job.stdout.trim();
    if (!raw) {
      return { err: job.stderr.trim() || "kulala-core openapi_run_operation failed" };
    }
    try {
      const parsed = JSON.parse(raw) as KulalaRequestResult | KulalaResponseWrapper;
      if ("type" in parsed && parsed.type === "responses" && Array.isArray(parsed.data)) {
        const first = parsed.data[0];
        if (first) return { result: first };
        return { err: "openapi_run_operation returned no results" };
      }
      if ("success" in parsed || "error" in parsed) {
        return { result: parsed as KulalaRequestResult };
      }
      return { err: "invalid kulala-core openapi_run_operation output" };
    } catch {
      return { err: "invalid kulala-core openapi_run_operation output" };
    }
  }

  async openapiToHttp(opts: {
    content: string;
    filepath?: string;
    line: number;
    column: number;
    env?: string;
    operationKey: string;
    parameterOverrides?: Record<string, string>;
    cwd?: string;
  }): Promise<{ result?: OpenAPIToHttpResult; err?: string }> {
    const job = await this.invoke(
      {
        action: "openapi_to_http",
        content: opts.content,
        filepath: opts.filepath,
        line: opts.line,
        column: opts.column,
        env: opts.env ?? "default",
        operationKey: opts.operationKey,
        ...(opts.parameterOverrides && Object.keys(opts.parameterOverrides).length > 0
          ? { parameterOverrides: opts.parameterOverrides }
          : {}),
      },
      opts.cwd,
    );
    const raw = job.stdout.trim();
    if (!raw) {
      return { err: job.stderr.trim() || "kulala-core openapi_to_http failed" };
    }
    try {
      const result = JSON.parse(raw) as OpenAPIToHttpResult & { type?: string };
      if (result.ok === true && typeof result.content === "string") return { result };
      if (result.ok === false) return { result };
      return { err: "invalid kulala-core openapi_to_http output" };
    } catch {
      return { err: "invalid kulala-core openapi_to_http output" };
    }
  }

  async clearOpenapiSchema(
    cacheKey?: string,
    cwd?: string,
  ): Promise<{ result?: ClearOpenAPISchemaResult; err?: string }> {
    const job = await this.invoke(
      {
        action: "clear_openapi_schema",
        ...(cacheKey ? { cacheKey } : {}),
      },
      cwd,
    );
    const raw = job.stdout.trim();
    if (!raw) {
      return { err: job.stderr.trim() || "kulala-core clear_openapi_schema failed" };
    }
    try {
      const parsed = JSON.parse(raw) as ClearOpenAPISchemaResult & {
        success?: boolean;
        error?: string;
      };
      if (parsed.success === false || parsed.error) {
        return { err: parsed.error ?? "clear_openapi_schema failed" };
      }
      return { result: { cleared: parsed.cleared ?? 0, keys: parsed.keys } };
    } catch {
      return { err: "invalid kulala-core clear_openapi_schema output" };
    }
  }

  async applyJqFilter(
    rawBody: string,
    filter: string,
    contentType?: string,
    cwd?: string,
  ): Promise<{ result?: KulalaJqFilterResult; err?: string }> {
    const job = await this.invoke(
      {
        action: "apply_jq_filter",
        rawBody,
        filter,
        contentType: contentType ?? "application/json",
      },
      cwd,
    );
    const raw = job.stdout.trim();
    if (!raw) {
      return { err: job.stderr.trim() || "kulala-core apply_jq_filter failed" };
    }
    try {
      const result = JSON.parse(raw) as KulalaJqFilterResult;
      if (result.success && result.filteredBody) {
        return { result };
      }
      return { err: result.error ?? "jq filter failed" };
    } catch {
      return { err: "invalid kulala-core apply_jq_filter output" };
    }
  }

  async websocketStart(
    connect: WebSocketConnectOptions,
    handlers: {
      onEvent: (event: WebSocketEvent) => void;
      onExit?: (code: number | null) => void;
    },
    cwd?: string,
  ): Promise<WebSocketSessionHandle | undefined> {
    let exe: string;
    try {
      exe = await this.executable();
    } catch {
      return undefined;
    }
    const tmp = path.join(
      os.tmpdir(),
      `kulala-ws-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    fs.writeFileSync(tmp, JSON.stringify(connect), "utf8");

    const child = spawn(exe, ["--websocket", "-i", tmp], {
      cwd: cwd && cwd.length > 0 ? cwd : undefined,
      env: this.env(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuf = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const flushLines = (chunk: string) => {
      stdoutBuf += chunk;
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as {
            type?: string;
            data?: string;
            error?: string;
            code?: number;
            remaining?: number;
          };
          if (msg.type === "ready") handlers.onEvent({ type: "ready" });
          else if (msg.type === "message" && msg.data != null) {
            handlers.onEvent({ type: "message", data: msg.data });
          } else if (msg.type === "sent" && msg.data != null) {
            handlers.onEvent({ type: "sent", data: msg.data });
          } else if (msg.type === "waiting") {
            handlers.onEvent({
              type: "waiting",
              remaining: typeof msg.remaining === "number" ? msg.remaining : 0,
            });
          } else if (msg.type === "script-done") {
            handlers.onEvent({ type: "script-done" });
          } else if (msg.type === "error") {
            handlers.onEvent({ type: "error", error: msg.error ?? "WebSocket error" });
          } else if (msg.type === "closed") {
            handlers.onEvent({ type: "closed", code: msg.code });
          }
        } catch {
          /* ignore malformed lines */
        }
      }
    };

    child.stdout.on("data", flushLines);
    child.stderr.on("data", (c: string) => {
      const text = summarizeCoreStderr(c);
      if (text) handlers.onEvent({ type: "error", error: text });
    });

    child.on("close", (code) => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      handlers.onExit?.(code);
    });

    return {
      pid: child.pid,
      send(data: string) {
        if (!child.stdin.writable) return;
        child.stdin.write(`${JSON.stringify({ op: "send", data })}\n`);
      },
      close() {
        if (!child.stdin.writable) return;
        child.stdin.write(`${JSON.stringify({ op: "close" })}\n`);
      },
      kill() {
        child.kill("SIGTERM");
      },
    };
  }
}

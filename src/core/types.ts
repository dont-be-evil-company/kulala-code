export type KulalaRunLimit =
  | { filter: "cursorPosition"; line: number; column: number }
  | { filter: "name"; name: string };

export type KulalaResponseBody =
  | { type: "text"; content: string; mediaType?: string }
  | {
      type: "binary";
      content: string;
      encoding: "base64";
      byteLength: number;
      mediaType?: string;
    }
  | { type: "json"; content: Record<string, unknown>; formatted?: string };

export type KulalaScriptConsoleOrigin = {
  phase: string;
  source?: string;
  file?: string;
  httpDirectiveLine?: number;
  line?: number;
  column?: number;
};

export type KulalaScriptConsoleLine = {
  level: "log" | "error" | "warn" | "info" | "debug";
  message: string;
  origin?: KulalaScriptConsoleOrigin;
  kind?: "log" | "test" | "assert";
  testName?: string;
  status?: "pass" | "fail";
};

export type KulalaRequestResult = {
  success: boolean;
  blockName?: string;
  prompt?: boolean;
  promptId?: string;
  promptType?: string;
  message?: string;
  inputs?: Array<{
    id: string;
    label?: string;
    type?: string;
    required?: boolean;
  }>;
  status?: number;
  headers?: Record<string, string>;
  url?: string;
  error?: string;
  skipped?: boolean;
  aborted?: boolean;
  httpCompleted?: boolean;
  protocol?: string;
  initialMessage?: string;
  messages?: Array<{ waitForServer: number; data: string }>;
  timeoutMs?: number;
  body?: KulalaResponseBody;
  filteredBody?: KulalaResponseBody;
  rawBody?: string;
  jqFilter?: string;
  timings?: Record<string, number>;
  scriptConsole?: KulalaScriptConsoleLine[];
  redirectChain?: unknown[];
  verboseTrace?: string;
  request?: { method?: string; url?: string; headers?: Record<string, string>; body?: string };
  /** Open OpenAPI explorer instead of the standard response panel. */
  openapiUi?: true;
  openapi?: OpenAPIUiPayload;
};

export type OpenAPIUITreeNodeKind =
  | "section"
  | "operation"
  | "parameter"
  | "response"
  | "schema"
  | "text"
  | "tryItOut";

export type OpenAPIUITreeNode = {
  id: string;
  kind: OpenAPIUITreeNodeKind;
  title: string;
  badge?: string;
  description?: string;
  children?: OpenAPIUITreeNode[];
  operationKey?: string;
  paramName?: string;
  paramIn?: string;
  defaultValue?: string;
  editable?: boolean;
  options?: string[];
  inputType?: "text" | "select" | "multiSelect";
};

export type OpenAPIUiPayload = {
  cacheKey: string;
  fromCache: boolean;
  tree: OpenAPIUITreeNode[];
  title?: string;
  version?: string;
};

export type OpenAPILoadResult =
  | { ok: true; openapi: OpenAPIUiPayload }
  | { ok: false; error: string };

export type OpenAPIToHttpResult = { ok: true; content: string } | { ok: false; error: string };

export type ClearOpenAPISchemaResult = {
  cleared: number;
  keys?: string[];
};

export type KulalaResponseWrapper = {
  type: "responses" | "error";
  data: KulalaRequestResult[];
};

export type KulalaEnvironmentCatalog = {
  $kulala?: {
    defaults?: {
      headers?: Record<string, string>;
      curlOptions?: string[];
    };
    env?: Record<string, unknown>;
  };
  environments: Record<string, Record<string, unknown>>;
};

export type KulalaDocument = {
  blocks: Array<{
    name?: string;
    contentStartLine?: number;
    position?: { start?: number; end?: number };
    runExpander?: boolean;
    request?: { method?: string };
    errors?: unknown[];
  }>;
  hasErrors?: boolean;
};

export type KulalaJqFilterResult = {
  success: boolean;
  filteredBody?: KulalaResponseBody;
  error?: string;
};

export type LspPosition = {
  line: number;
  character: number;
};

export type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

export type LspDiagnostic = {
  range: LspRange;
  severity: number;
  message: string;
  source?: string;
};

export const LspCompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  File: 17,
  Reference: 18,
  Folder: 19,
  EnumMember: 20,
  Constant: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
} as const;

export type LspTextEdit = {
  range: LspRange;
  newText: string;
};

export type LspCompletionItem = {
  label: string;
  labelDetails?: { description?: string };
  kind?: number;
  detail?: string;
  documentation?: { kind: "plaintext" | "markdown"; value: string };
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
  textEdit?: LspTextEdit;
};

export type LspCompletionList = {
  isIncomplete: boolean;
  items: LspCompletionItem[];
};

export type LspHover = {
  contents: string | { kind: string; value: string; language?: string };
};

export type LspDocumentSymbol = {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
};

export const LspSymbolKind = {
  File: 1,
  Module: 2,
  Function: 12,
} as const;

export type KulalaLspFiletype = "http" | "rest" | "javascript";

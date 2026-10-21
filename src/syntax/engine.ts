import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { Language, Parser, Query, type Tree } from "web-tree-sitter";
import { resolveCapture } from "./captureMap";
import { loadInjectedGrammar } from "./grammars";
import {
  collectInjectionSpans,
  injectionRange,
  rangeContains,
  shiftRange,
  type InjectionSpan,
} from "./injections";

export type HighlightToken = {
  range: vscode.Range;
  type: string;
  modifiers: string[];
};

let initPromise: Promise<void> | undefined;
let language: Language | undefined;
let highlightQuery: Query | undefined;
let injectionQuery: Query | undefined;

async function ensureParser(context: vscode.ExtensionContext): Promise<void> {
  if (language && highlightQuery && injectionQuery) {
    return;
  }
  if (!initPromise) {
    initPromise = (async () => {
      const runtimeWasm = path.join(
        context.extensionPath,
        "node_modules",
        "web-tree-sitter",
        "tree-sitter.wasm",
      );
      await Parser.init({
        locateFile: () => runtimeWasm,
      });

      const grammarWasm = path.join(context.extensionPath, "syntaxes", "kulala_http.wasm");
      if (!fs.existsSync(grammarWasm)) {
        throw new Error(
          `Missing ${grammarWasm}. Run: npm run build:syntax (requires git and tree-sitter CLI).`,
        );
      }
      language = await Language.load(grammarWasm);

      const queryDir = path.join(context.extensionPath, "syntaxes", "queries", "kulala_http");
      const highlightsPath = path.join(queryDir, "highlights.scm");
      const injectionsPath = path.join(queryDir, "injections.scm");
      highlightQuery = new Query(language, fs.readFileSync(highlightsPath, "utf8"));
      injectionQuery = new Query(language, fs.readFileSync(injectionsPath, "utf8"));
    })();
  }
  await initPromise;
}

function splitToken(token: HighlightToken): HighlightToken[] {
  const { range } = token;
  if (range.start.line === range.end.line) {
    return [token];
  }
  const maxCol = 100_000;
  const out: HighlightToken[] = [];
  out.push({
    ...token,
    range: new vscode.Range(range.start, new vscode.Position(range.start.line, maxCol)),
  });
  for (let line = range.start.line + 1; line < range.end.line; line++) {
    out.push({
      ...token,
      range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, maxCol)),
    });
  }
  out.push({
    ...token,
    range: new vscode.Range(new vscode.Position(range.end.line, 0), range.end),
  });
  return out;
}

function nodeToTokens(tree: Tree, query: Query, rangeOffset?: vscode.Position): HighlightToken[] {
  const matches = query.matches(tree.rootNode);
  const raw: HighlightToken[] = [];

  for (const match of matches) {
    for (const capture of match.captures) {
      const resolved = resolveCapture(capture.name);
      if (!resolved) {
        continue;
      }
      const start = new vscode.Position(
        capture.node.startPosition.row,
        capture.node.startPosition.column,
      );
      const end = new vscode.Position(
        capture.node.endPosition.row,
        capture.node.endPosition.column,
      );
      let range = new vscode.Range(start, end);
      if (rangeOffset) {
        range = shiftRange(range, rangeOffset);
      }
      raw.push({
        range,
        type: resolved.type,
        modifiers: resolved.modifiers,
      });
    }
  }

  return raw.flatMap(splitToken);
}

async function tokensForInjection(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  span: InjectionSpan,
): Promise<HighlightToken[]> {
  try {
    const grammar = await loadInjectedGrammar(context, span.language);
    if (!grammar) {
      return [];
    }

    const slice = blankInjectionHoles(
      document.getText().slice(span.startIndex, span.endIndex),
      span,
    );
    if (!slice) {
      return [];
    }

    const parser = new Parser();
    parser.setLanguage(grammar.language);
    const tree = parser.parse(slice);
    if (!tree) {
      return [];
    }

    const base = document.positionAt(span.startIndex);
    return nodeToTokens(tree, grammar.highlightQuery, base);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Kulala: ${span.language} injection highlighting failed: ${msg}`);
    return [];
  }
}

function blankInjectionHoles(slice: string, span: InjectionSpan): string {
  if (span.holes.length === 0) return slice;
  let text = slice;
  const holes = [...span.holes].sort((a, b) => b.startIndex - a.startIndex);
  for (const hole of holes) {
    const start = hole.startIndex - span.startIndex;
    const end = hole.endIndex - span.startIndex;
    if (start < 0 || end > text.length || start >= end) continue;
    text = text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
  }
  return text;
}

function comparePositions(a: vscode.Position, b: vscode.Position): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.character - b.character;
}

function compareTokens(a: HighlightToken, b: HighlightToken): number {
  const byStart = comparePositions(a.range.start, b.range.start);
  if (byStart !== 0) {
    return byStart;
  }
  return comparePositions(a.range.end, b.range.end);
}

function sortTokens(tokens: HighlightToken[]): HighlightToken[] {
  return [...tokens].sort(compareTokens);
}

function mergeWithInjections(
  hostTokens: HighlightToken[],
  injectionTokens: HighlightToken[],
  injectionRanges: vscode.Range[],
): HighlightToken[] {
  const filtered = hostTokens.filter(
    (token) => !injectionRanges.some((outer) => rangeContains(outer, token.range)),
  );
  return sortTokens(filtered.concat(injectionTokens));
}

async function allTokens(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  tree: Tree,
): Promise<HighlightToken[]> {
  if (!highlightQuery || !injectionQuery) {
    return [];
  }

  const hostTokens = sortTokens(nodeToTokens(tree, highlightQuery));
  const spans = collectInjectionSpans(tree, injectionQuery);
  if (spans.length === 0) {
    return hostTokens;
  }

  const injectionRanges = spans.map((s) => injectionRange(document, s));
  const injectionParts = await Promise.all(
    spans.map((span) => tokensForInjection(context, document, span)),
  );
  const injectionTokens = injectionParts.flat();

  return mergeWithInjections(hostTokens, injectionTokens, injectionRanges);
}

export class KulalaSyntaxEngine {
  private readonly trees = new Map<string, Tree>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async ready(): Promise<void> {
    await ensureParser(this.context);
  }

  invalidate(uri: string): void {
    this.trees.get(uri)?.delete();
    this.trees.delete(uri);
  }

  async tokensForDocument(document: vscode.TextDocument): Promise<HighlightToken[]> {
    await this.ready();
    if (!language) {
      return [];
    }

    const key = document.uri.toString();
    let tree = this.trees.get(key);
    if (!tree) {
      const parser = new Parser();
      parser.setLanguage(language);
      const parsed = parser.parse(document.getText());
      if (!parsed) {
        return [];
      }
      tree = parsed;
      this.trees.set(key, tree);
    }

    return allTokens(this.context, document, tree);
  }

  async reparse(document: vscode.TextDocument): Promise<HighlightToken[]> {
    await this.ready();
    if (!language) {
      return [];
    }
    const key = document.uri.toString();
    this.trees.get(key)?.delete();
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(document.getText());
    if (!tree) {
      return [];
    }
    this.trees.set(key, tree);
    return allTokens(this.context, document, tree);
  }
}

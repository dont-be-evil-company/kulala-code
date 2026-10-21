import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { Language, Query } from "web-tree-sitter";

export const INJECTED_LANGUAGES = ["json", "javascript", "graphql", "xml"] as const;

export type InjectedLanguage = (typeof INJECTED_LANGUAGES)[number];

export function isInjectedLanguage(lang: string): lang is InjectedLanguage {
  return (INJECTED_LANGUAGES as readonly string[]).includes(lang);
}

type LoadedGrammar = {
  language: Language;
  highlightQuery: Query;
};

const cache = new Map<InjectedLanguage, LoadedGrammar>();

export async function loadInjectedGrammar(
  context: vscode.ExtensionContext,
  lang: InjectedLanguage,
): Promise<LoadedGrammar | undefined> {
  const cached = cache.get(lang);
  if (cached) {
    return cached;
  }

  const dir = path.join(context.extensionPath, "syntaxes", "grammars", lang);
  const wasmPath = path.join(dir, "grammar.wasm");
  const highlightsPath = path.join(dir, "highlights.scm");

  if (!fs.existsSync(wasmPath) || !fs.existsSync(highlightsPath)) {
    return undefined;
  }

  try {
    const language = await Language.load(wasmPath);
    const querySource = fs.readFileSync(highlightsPath, "utf8");
    const highlightQuery = new Query(language, querySource);
    const loaded = { language, highlightQuery };
    cache.set(lang, loaded);
    return loaded;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Kulala: failed to load ${lang} injection grammar: ${msg}`);
    return undefined;
  }
}

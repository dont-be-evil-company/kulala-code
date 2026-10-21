#!/usr/bin/env bash

# Fetch kulala_http tree-sitter grammar and bundle injection grammars into syntaxes/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${KULALA_HTTP_GRAMMAR_REPO:-https://github.com/dont-be-evil-company/tree-sitter-kulala-http.git}"
REF="${KULALA_HTTP_GRAMMAR_REF:-main}"
CACHE="${KULALA_HTTP_GRAMMAR_DIR:-$ROOT/.cache/tree-sitter-kulala-http}"
OUT="$ROOT/syntaxes"
QUERIES="$OUT/queries/kulala_http"
GRAMMARS="$OUT/grammars"
NODE_MODULES="$ROOT/node_modules"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to fetch grammar repos" >&2
  exit 1
fi

if ! command -v tree-sitter >/dev/null 2>&1; then
  echo "tree-sitter CLI is required (https://tree-sitter.github.io/)" >&2
  exit 1
fi

mkdir -p "$QUERIES" "$GRAMMARS"

sync_repo() {
  local url="$1"
  local ref="$2"
  local dir="$3"
  if [[ -d "$dir/.git" ]]; then
    echo "Updating $url ($ref) in $dir"
    git -C "$dir" fetch --depth 1 origin "$ref"
    git -C "$dir" checkout -q FETCH_HEAD
  else
    echo "Cloning $url ($ref) into $dir"
    rm -rf "$dir"
    mkdir -p "$(dirname "$dir")"
    git clone --depth 1 --branch "$ref" "$url" "$dir"
  fi
}

install_grammar() {
  local lang="$1"
  local wasm_src="$2"
  local highlights_src="$3"
  local dest="$GRAMMARS/$lang"
  mkdir -p "$dest"
  cp "$wasm_src" "$dest/grammar.wasm"
  cp "$highlights_src" "$dest/highlights.scm"
  echo "  $lang"
}

fetch_highlights() {
  local url="$1"
  local dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  else
    echo "curl is required to fetch $url" >&2
    exit 1
  fi
}

# --- kulala_http host grammar ---
sync_repo "$REPO" "$REF" "$CACHE"

echo "Building kulala_http.wasm"
(cd "$CACHE" && tree-sitter build --wasm)

WASM_SRC=""
for candidate in tree-sitter-kulala_http.wasm tree-sitter-kulala-http.wasm; do
  if [[ -f "$CACHE/$candidate" ]]; then
    WASM_SRC="$CACHE/$candidate"
    break
  fi
done

if [[ -z "$WASM_SRC" ]]; then
  echo "tree-sitter build did not produce a .wasm file in $CACHE" >&2
  exit 1
fi

cp "$WASM_SRC" "$OUT/kulala_http.wasm"
rm -f "$OUT/tree-sitter-kulala_http.wasm" "$OUT/tree-sitter-kulala-http.wasm"

if [[ ! -d "$CACHE/queries/kulala_http" ]]; then
  echo "Missing queries/kulala_http in $CACHE" >&2
  exit 1
fi

cp "$CACHE/queries/kulala_http/"*.scm "$QUERIES/"

if [[ ! -f "$ROOT/scripts/kulala_http/injections.scm" ]]; then
  echo "Missing scripts/kulala_http/injections.scm" >&2
  exit 1
fi
cp "$ROOT/scripts/kulala_http/injections.scm" "$QUERIES/injections.scm"

VERSION="$(node -e "
  const fs = require('fs');
  const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  process.stdout.write(j.metadata?.version ?? '');
" "$CACHE/tree-sitter.json" 2>/dev/null || true)"
if [[ -n "$VERSION" ]]; then
  echo "$VERSION" >"$OUT/grammar-version.txt"
fi

# --- injection grammars (npm + git) ---
if [[ ! -d "$NODE_MODULES/tree-sitter-json" ]]; then
  echo "Run npm install first (tree-sitter-* packages are devDependencies)" >&2
  exit 1
fi

echo "Bundling injection grammars into $GRAMMARS"

TMP_HIGHLIGHTS="$ROOT/.cache/syntax-highlights"
mkdir -p "$TMP_HIGHLIGHTS"

# json, javascript - prebuilt wasm in npm packages
install_grammar json \
  "$NODE_MODULES/tree-sitter-json/tree-sitter-json.wasm" \
  "$NODE_MODULES/tree-sitter-json/queries/highlights.scm"

install_grammar javascript \
  "$NODE_MODULES/tree-sitter-javascript/tree-sitter-javascript.wasm" \
  "$NODE_MODULES/tree-sitter-javascript/queries/highlights.scm"

# graphql - build wasm from git; highlights from nvim-treesitter
GRAPHQL_CACHE="${KULALA_GRAPHQL_GRAMMAR_DIR:-$ROOT/.cache/tree-sitter-graphql}"
GRAPHQL_REPO="${KULALA_GRAPHQL_GRAMMAR_REPO:-https://github.com/joowani/tree-sitter-graphql.git}"
GRAPHQL_REF="${KULALA_GRAPHQL_GRAMMAR_REF:-main}"
sync_repo "$GRAPHQL_REPO" "$GRAPHQL_REF" "$GRAPHQL_CACHE"
echo "Building graphql grammar.wasm"
(cd "$GRAPHQL_CACHE" && tree-sitter build --wasm)
GRAPHQL_WASM=""
for candidate in tree-sitter-graphql.wasm; do
  if [[ -f "$GRAPHQL_CACHE/$candidate" ]]; then
    GRAPHQL_WASM="$GRAPHQL_CACHE/$candidate"
    break
  fi
done
if [[ -z "$GRAPHQL_WASM" ]]; then
  echo "graphql wasm build failed in $GRAPHQL_CACHE" >&2
  exit 1
fi
fetch_highlights \
  "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/graphql/highlights.scm" \
  "$TMP_HIGHLIGHTS/graphql-highlights.scm"
install_grammar graphql "$GRAPHQL_WASM" "$TMP_HIGHLIGHTS/graphql-highlights.scm"

# xml - build wasm from tree-sitter-grammars (xml/ subdir)
XML_CACHE="${KULALA_XML_GRAMMAR_DIR:-$ROOT/.cache/tree-sitter-xml}"
XML_REPO="${KULALA_XML_GRAMMAR_REPO:-https://github.com/tree-sitter-grammars/tree-sitter-xml.git}"
XML_REF="${KULALA_XML_GRAMMAR_REF:-master}"
sync_repo "$XML_REPO" "$XML_REF" "$XML_CACHE"
echo "Building xml grammar.wasm"
(cd "$XML_CACHE/xml" && tree-sitter build --wasm)
install_grammar xml \
  "$XML_CACHE/xml/tree-sitter-xml.wasm" \
  "$XML_CACHE/queries/xml/highlights.scm"

echo "Syntax assets updated in $OUT (kulala_http ${VERSION:-unknown})"

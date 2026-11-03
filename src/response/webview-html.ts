import * as fs from "node:fs";
import * as vscode from "vscode";
import type { GraphQLViewState } from "../../shared/graphql-view";
import type { OpenAPIViewState } from "../../shared/openapi-view";
import type { WebviewPayload } from "../../shared/response-view";

export function webviewDistUri(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "webview");
}

function webviewBaseHref(webview: vscode.Webview, base: vscode.Uri): string {
  const href = webview.asWebviewUri(base).toString();
  return href.endsWith("/") ? href : `${href}/`;
}

/** SvelteKit emits root-absolute /_app/ URLs; rewrite to webview-accessible URIs. */
function rewriteWebviewAssets(html: string, webview: vscode.Webview, base: vscode.Uri): string {
  const withAssets = html.replace(
    /(["'])\/_app\/([^"']+)/g,
    (_match, quote: string, path: string) => {
      const assetUri = vscode.Uri.joinPath(base, "_app", ...path.split("/"));
      const webviewUri = webview.asWebviewUri(assetUri);
      return `${quote}${webviewUri.toString()}`;
    },
  );
  return withAssets.replace(
    /base:\s*new URL\(['"]\.['"],\s*location\)\.pathname\.slice\(0,\s*-1\)/g,
    'base: ""',
  );
}

function injectHeadExtras(
  html: string,
  opts: {
    routeHash: string;
    injectScript: string;
    webview: vscode.Webview;
    base: vscode.Uri;
    cspSource: string;
  },
): string {
  const csp = [
    "default-src 'none'",
    `style-src ${opts.cspSource} 'unsafe-inline'`,
    `script-src ${opts.cspSource} 'unsafe-inline' blob:`,
    `worker-src ${opts.cspSource} blob: data:`,
    `font-src ${opts.cspSource} data:`,
    `connect-src ${opts.cspSource}`,
    "img-src data: https:",
  ].join("; ");
  const injection = [
    `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    `<base href="${webviewBaseHref(opts.webview, opts.base)}" />`,
    `<script>location.hash = ${JSON.stringify(opts.routeHash)};</script>`,
    opts.injectScript,
  ].join("\n");
  return html.replace("<head>", `<head>\n${injection}`);
}

function loadIndexHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
  const base = webviewDistUri(extensionUri);
  const indexPath = vscode.Uri.joinPath(base, "index.html");
  let html = fs.readFileSync(indexPath.fsPath, "utf8");
  return rewriteWebviewAssets(html, webview, base);
}

export function renderResponseWebview(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  payload: WebviewPayload,
): string {
  const base = webviewDistUri(extensionUri);
  const html = loadIndexHtml(extensionUri, webview);
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return injectHeadExtras(html, {
    routeHash: "#/",
    injectScript: `<script>window.__KULALA__=${json};</script>`,
    webview,
    base,
    cspSource: webview.cspSource,
  });
}

export function renderOpenapiWebview(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  payload: OpenAPIViewState,
): string {
  const base = webviewDistUri(extensionUri);
  const html = loadIndexHtml(extensionUri, webview);
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return injectHeadExtras(html, {
    routeHash: "#/openapi",
    injectScript: `<script>window.__KULALA_OPENAPI__=${json};</script>`,
    webview,
    base,
    cspSource: webview.cspSource,
  });
}

export function postWebviewState(webview: vscode.Webview, payload: WebviewPayload): void {
  void webview.postMessage({ type: "state", payload });
}

export function renderGraphqlWebview(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  payload: GraphQLViewState,
): string {
  const base = webviewDistUri(extensionUri);
  const html = loadIndexHtml(extensionUri, webview);
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return injectHeadExtras(html, {
    routeHash: "#/graphql",
    injectScript: `<script>window.__KULALA_GRAPHQL__=${json};</script>`,
    webview,
    base,
    cspSource: webview.cspSource,
  });
}

export function postOpenapiState(webview: vscode.Webview, payload: OpenAPIViewState): void {
  void webview.postMessage({ type: "openapiState", payload });
}

export function postGraphqlState(webview: vscode.Webview, payload: GraphQLViewState): void {
  void webview.postMessage({ type: "graphqlState", payload });
}

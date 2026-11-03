import * as path from "node:path";
import * as vscode from "vscode";
import type { KulalaCoreBridge } from "../core/bridge";
import type { KulalaDocument } from "../core/types";
import { isHttpDocument } from "../document";
import { codeLensLine0 } from "../requestLine";

type ParsedBlock = KulalaDocument["blocks"][number];

function blockHasOperator(
  document: vscode.TextDocument,
  block: ParsedBlock,
  operator: string,
): boolean {
  const start0 = Math.max(0, (block.position?.start ?? 1) - 1);
  const end0 = Math.min(document.lineCount, block.position?.end ?? start0 + 1);
  const pattern = new RegExp(`@${operator}\\b`);
  for (let line = start0; line < end0; line++) {
    if (pattern.test(document.lineAt(line).text)) return true;
  }
  return false;
}

function blockHasOpenapiOperator(document: vscode.TextDocument, block: ParsedBlock): boolean {
  const start0 = Math.max(0, (block.position?.start ?? 1) - 1);
  const end0 = Math.min(document.lineCount, block.position?.end ?? start0 + 1);
  for (let line = start0; line < end0; line++) {
    if (/@kulala-openapi-explorer\b/.test(document.lineAt(line).text)) {
      return true;
    }
  }
  return false;
}

export class KulalaCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly bridge: KulalaCoreBridge) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    if (!isHttpDocument(document)) return [];

    const filepath = document.uri.scheme === "file" ? document.uri.fsPath : undefined;
    const cwd = filepath ? path.dirname(filepath) : undefined;
    const { doc } = await this.bridge.parse(document.getText(), filepath, cwd);
    const lenses: vscode.CodeLens[] = [];

    if (doc?.blocks) {
      for (const block of doc.blocks) {
        const line = codeLensLine0(document, block);
        if (line === undefined) {
          continue;
        }
        const range = new vscode.Range(line, 0, line, 0);
        const isGraphql = blockHasOperator(document, block, "kulala-graphql-explorer");
        const isOpenapi = blockHasOpenapiOperator(document, block);
        const explorer = isGraphql
          ? { title: "$(play) Open GraphQL explorer", command: "kulala.openGraphqlExplorer" }
          : isOpenapi
            ? { title: "$(play) Open OpenAPI explorer", command: "kulala.openOpenapiExplorer" }
            : undefined;
        lenses.push(
          new vscode.CodeLens(range, {
            title: explorer?.title ?? "$(play) Send Request",
            command: explorer?.command ?? "kulala.sendRequest",
            arguments: [line],
          }),
        );
        if (explorer) {
          lenses.push(
            new vscode.CodeLens(range, {
              title: "$(play) Send Request",
              command: "kulala.sendRequest",
              arguments: [line],
            }),
          );
        }
      }
      if (lenses.length) return lenses;
    }

    // Fallback: ### separators → lens on the ### line
    const text = document.getText();
    for (const match of text.matchAll(/^###.*$/gm)) {
      const offset = match.index ?? 0;
      const line = document.positionAt(offset).line;
      const range = new vscode.Range(line, 0, line, 0);
      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(play) Send Request",
          command: "kulala.sendRequest",
          arguments: [line],
        }),
      );
    }
    return lenses;
  }
}

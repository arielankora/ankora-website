import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// The literal text a source file puts on a screen: string literals, the
// parts of template literals, and JSX text. Comments are not text a
// person sees, so they are not here, and neither are regular expressions.
// Read with the TypeScript parser rather than a regular expression, so a
// quote inside a comment or an apostrophe inside JSX cannot fool it.

export type SourceString = { file: string; line: number; text: string };

export function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

export function sourceStrings(file: string): SourceString[] {
  const src = readFileSync(file, "utf-8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const out: SourceString[] = [];
  const push = (node: ts.Node, text: string) => {
    if (!text.trim()) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({ file, line: line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) push(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) push(node, node.text);
    else if (ts.isJsxText(node)) push(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export const HEBREW = /[֐-׿]/;

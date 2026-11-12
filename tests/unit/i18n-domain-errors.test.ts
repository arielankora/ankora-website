import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { sourceFiles } from "../helpers/source-strings";
import he from "../../messages/he.json";
import en from "../../messages/en.json";

/**
 * ADR 0006. A DomainError's code is a key under `domainErrors`, looked up
 * at runtime (lib/i18n/domain-errors.ts), so no type checks it. This does:
 * every code thrown anywhere in lib/ or app/ exists in both dictionaries,
 * and its placeholders are the values the throw passes.
 */

type Tree = { [key: string]: string | Tree };

function lookup(tree: Tree, dotted: string): string | undefined {
  let node: string | Tree | undefined = tree.domainErrors as Tree;
  for (const part of dotted.split(".")) {
    if (!node || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]))].sort();
}

type Throw = { file: string; line: number; code: string; values: string[] | null };

function domainErrorThrows(file: string): Throw[] {
  const src = readFileSync(file, "utf8");
  if (!src.includes("DomainError(")) return [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Throw[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "DomainError") {
      const [code, , values] = node.arguments ?? [];
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      if (code && ts.isStringLiteral(code)) {
        // Value names, when the third argument is an object literal; null
        // when it is computed and cannot be read here.
        const names =
          values === undefined
            ? []
            : ts.isObjectLiteralExpression(values)
              ? values.properties.map((p) => (p.name && ts.isIdentifier(p.name) ? p.name.text : p.name && ts.isStringLiteral(p.name) ? p.name.text : "?")).sort()
              : null;
        out.push({ file, line: line + 1, code: code.text, values: names });
      } else {
        out.push({ file, line: line + 1, code: "<not a string literal>", values: null });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const THROWS = [...sourceFiles("lib"), ...sourceFiles("app")].flatMap(domainErrorThrows);

describe("domain error codes (ADR 0006)", () => {
  it("are written as string literals, so they can be checked", () => {
    expect(THROWS.filter((t) => t.code === "<not a string literal>").map((t) => `${t.file}:${t.line}`)).toEqual([]);
  });

  it("each name a message in both dictionaries, with the placeholders the throw fills", () => {
    const problems: string[] = [];
    for (const t of THROWS) {
      for (const [name, dict] of [
        ["he", he],
        ["en", en],
      ] as const) {
        const message = lookup(dict as Tree, t.code);
        if (message === undefined) {
          problems.push(`${t.file}:${t.line} ${t.code} is missing from ${name}.json`);
          continue;
        }
        if (t.values && JSON.stringify(placeholders(message)) !== JSON.stringify(t.values)) {
          problems.push(`${t.file}:${t.line} ${t.code} (${name}) expects {${placeholders(message).join(", ")}} but is given {${t.values.join(", ")}}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/**
 * The codes a subclass passes to super(...) (OverlapError, ClosedBankError,
 * TaskPlanRuleError...) and the full keys the domain hands a screen
 * (OVERRIDE_WARNING_KEY) are not `new DomainError` calls, so the test above
 * cannot see them. These are: every string literal in the first argument
 * of `super(...)` or `new <Something>Error(...)` that has the shape of a
 * code ("area.name"), through conditionals, and every string that starts
 * with "domainErrors.".
 */
function subclassCodes(file: string): { file: string; line: number; code: string }[] {
  const src = readFileSync(file, "utf8");
  if (!src.includes("DomainError") && !src.includes("domainErrors.")) return [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { file: string; line: number; code: string }[] = [];
  const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const literalsIn = (node: ts.Node): ts.StringLiteral[] => {
    if (ts.isStringLiteral(node)) return [node];
    if (ts.isConditionalExpression(node)) return [...literalsIn(node.whenTrue), ...literalsIn(node.whenFalse)];
    if (ts.isParenthesizedExpression(node)) return literalsIn(node.expression);
    return [];
  };
  const visit = (node: ts.Node) => {
    const isSuper = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword;
    const isNewError =
      ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /Error$/.test(node.expression.text) && node.expression.text !== "DomainError";
    if ((isSuper || isNewError) && (node as ts.CallExpression).arguments?.[0]) {
      for (const lit of literalsIn((node as ts.CallExpression).arguments[0])) {
        if (/^[a-z][A-Za-z]*\.[A-Za-z_][\w.]*$/.test(lit.text)) out.push({ file, line: at(lit), code: lit.text });
      }
    }
    if (ts.isStringLiteral(node) && node.text.startsWith("domainErrors.")) {
      out.push({ file, line: at(node), code: node.text.slice("domainErrors.".length) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("domain error codes thrown through subclasses and constants (ADR 0006)", () => {
  const found = [...sourceFiles("lib"), ...sourceFiles("app"), ...sourceFiles("components")].flatMap(subclassCodes);

  it("are found at all, so this test is not passing on nothing", () => {
    expect(found.map((f) => f.code)).toEqual(expect.arrayContaining(["timeEntries.overlap", "closedBank.closedChange", "closedBank.overrideWarning"]));
  });

  it("exist in both dictionaries", () => {
    const missing: string[] = [];
    for (const f of found) {
      for (const [name, dict] of [
        ["he", he],
        ["en", en],
      ] as const) {
        if (lookup(dict as Tree, f.code) === undefined) missing.push(`${f.file}:${f.line} ${f.code} is missing from ${name}.json`);
      }
    }
    expect(missing).toEqual([]);
  });
});

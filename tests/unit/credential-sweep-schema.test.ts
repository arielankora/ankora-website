import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CREDENTIAL_PATTERNS } from "../../qa/e2e/routes";

// Does the served-document sweep still cover everything the schema calls
// credential material?
//
// The sweep in qa/e2e/routes.ts reads every authenticated screen under two
// sessions and fails the build if a document contains any of its patterns.
// It is the only thing standing between "a page handed a database row to a
// client component" and that row's secret columns being serialised into the
// RSC payload inside the HTML. It has caught that once already, in #84.
//
// Its weakness is that the pattern list was maintained by remembering. It
// was written in September against the one credential column that existed
// then, extended by hand on 15.10 for the vault, and on 20.10 it still did
// not cover accessTokenHash, refreshTokenHash, clientSecretHash or
// codeHash. Nothing had told anyone, because nothing was looking.
//
// This test is what looks. It reads the schema, takes every column whose
// name says it holds credential material, and insists each one is either
// matched by the sweep or listed below with a reason. A new column is a
// failing test until a person decides which.

/** Column names that claim to hold credential material. */
function credentialColumns(schema: string): { model: string; field: string }[] {
  const out: { model: string; field: string }[] = [];
  let model: string | null = null;
  for (const raw of schema.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^model\s+(\w+)/);
    if (m) {
      model = m[1];
      continue;
    }
    if (line === "}") {
      model = null;
      continue;
    }
    if (!model || line.startsWith("//") || line.startsWith("@@")) continue;
    const f = line.match(/^(\w+)\s+\S/);
    if (!f) continue;
    if (/(hash|secret|ciphertext|dek|privatekey)/i.test(f[1])) out.push({ model, field: f[1] });
  }
  return out;
}

/**
 * Columns the sweep deliberately does not match, each with the reason.
 *
 * Not a list of "things we did not get round to". Everything here has been
 * looked at and is safe to render; anything else must be covered.
 */
const REVIEWED: Record<string, string> = {
  contentHash: "a document's content digest, not a credential. It identifies bytes, it does not open anything.",
  secretUpdatedAt: "a timestamp. The vault screen shows it on purpose, so that someone can see how stale a password is.",
};

const covered = (name: string) => CREDENTIAL_PATTERNS.some(({ pattern }) => pattern.test(`"${name}":"x"`));

describe("the served-document sweep against the schema", () => {
  const schema = fs.readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const columns = credentialColumns(schema);

  it("finds the credential columns at all", () => {
    // If the extraction breaks, every assertion below passes vacuously -
    // which is the shape of a test that guards nothing. These four are the
    // ones the hunt on 20.10 was about.
    const names = columns.map((c) => c.field);
    expect(names).toEqual(expect.arrayContaining(["passwordHash", "accessTokenHash", "refreshTokenHash", "clientSecretHash", "codeHash"]));
  });

  it("covers every credential column, or says why not", () => {
    const uncovered = columns
      .filter((c) => !covered(c.field) && !(c.field in REVIEWED))
      .map((c) => `${c.model}.${c.field}`);
    expect(
      uncovered,
      [
        "These columns look like credential material and the sweep in qa/e2e/routes.ts does not match them.",
        "A screen that hands one of these rows whole to a client component would ship it inside the page HTML,",
        "and the sweep would stay quiet.",
        "",
        "Add a pattern to CREDENTIAL_PATTERNS, or add the column to REVIEWED in this file with the reason it is safe.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("matches the four that were missing on 20.10", () => {
    for (const name of ["accessTokenHash", "refreshTokenHash", "clientSecretHash", "codeHash"]) {
      expect(covered(name), `${name} is not matched by any sweep pattern`).toBe(true);
    }
  });

  it("still matches the ones it always did", () => {
    for (const name of ["passwordHash", "tokenHash", "secretCiphertext", "wrappedDek", "secretIv", "secretTag"]) {
      expect(covered(name), `${name} is not matched by any sweep pattern`).toBe(true);
    }
  });

  it("does not match ordinary markup", () => {
    // The file's own rule: a pattern that reads natural language fails the
    // build on a login form. These are the strings that have tripped
    // candidate patterns before.
    for (const innocent of ['class="task-supervisor"', "<label>password</label>", '"contentHash":"abc"', "sk-eleton"]) {
      expect(CREDENTIAL_PATTERNS.some(({ pattern }) => pattern.test(innocent)), innocent).toBe(false);
    }
  });
});

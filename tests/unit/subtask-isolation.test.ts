import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Tasks phase 5: steps are not tasks, to every screen that counts tasks.
//
// `Task.parentId` is one column, and it reaches fourteen queries across
// five files. Getting it wrong is not cosmetic:
//
//   - a step that leaks into the portal is a second promise the client
//     never made,
//   - a step that leaks into "הבטחות שלא זזו היום" inflates a manager's
//     number by however many steps somebody bothered to write down,
//   - a step that leaks into "מה עליי" makes a person's own list grow
//     every time they break work down, which teaches them not to.
//
// None of those fail loudly. They just quietly say a larger number.
//
// So this test reads the domain as TEXT and requires every task query to
// say which side it is on: either it spreads `TOP_LEVEL_ONLY`, or it
// carries a `subtasks-included` comment nearby saying it means to see
// them. There is no third option, and a new query written next month
// fails here until its author has answered the question.
//
// The technique is this repo's own: `audit-labels.test.ts` reads the
// same file to check every audited action has a Hebrew label, and it has
// caught a real omission. A rule that depends on everyone remembering is
// a rule with a half-life.

const ROOT = path.resolve(__dirname, "..", "..");

/// Every file that queries tasks on behalf of a screen or a number.
///
/// Listed rather than globbed on purpose: a glob would silently start
/// covering a new file and silently stop covering a renamed one, and
/// this test's whole job is to not be silent.
const FILES = [
  "lib/app-domain/tasks.ts",
  "lib/app-domain/portal-summary.ts",
  "lib/app-domain/client-file.ts",
  "lib/app-domain/client-portal.ts",
  "lib/app-domain/backup-export.ts",
];

/// The call shapes that read more than one task.
///
/// `findFirst` and `findUnique` are deliberately absent: they fetch one
/// row by id, and fetching a step you asked for by id is not a leak.
const QUERY = /prisma\.task\.(findMany|count|groupBy|aggregate)\s*\(/g;

type Query = { file: string; line: number; body: string };

/// The text from the call up to the closing of its options object.
///
/// Brace counting rather than a regex, because a `where` clause here
/// nests three or four levels deep and no regex reads that honestly.
function queriesIn(file: string): Query[] {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  const found: Query[] = [];
  for (const match of source.matchAll(QUERY)) {
    const start = match.index!;
    let depth = 0;
    let end = start;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (c === "(" || c === "{") depth++;
      else if (c === ")" || c === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    found.push({
      file,
      line: source.slice(0, start).split("\n").length,
      // The call and nothing before it. A marker has to sit INSIDE the
      // query it excuses, because a window of lead-in text would let a
      // comment on one query quietly excuse the one written under it,
      // which is the exact failure this whole test is here to prevent.
      body: source.slice(start, end + 1),
    });
  }
  return found;
}

describe("a step never counts as a task", () => {
  const queries = FILES.flatMap(queriesIn);

  it("finds the queries at all, so a passing run means something", () => {
    // If a refactor moves these somewhere this test does not read, every
    // assertion below passes by looking at nothing. This is the guard on
    // the guard.
    expect(queries.length).toBeGreaterThanOrEqual(12);
  });

  it("every task query either excludes steps or says it wants them", () => {
    const undecided = queries.filter(
      (q) => !q.body.includes("TOP_LEVEL_ONLY") && !q.body.includes("subtasks-included")
    );

    expect(
      undecided.map((q) => `${q.file}:${q.line}`),
      "these task queries have not said whether a subtask belongs in their answer. Spread TOP_LEVEL_ONLY, or write a `subtasks-included` comment saying why not"
    ).toEqual([]);
  });

  it("the queries that do want them are exactly the three that should", () => {
    // Each opt-out names itself, and the names are listed here.
    //
    // By NAME and not by file:line, so that moving code around does not
    // fail this, and adding a fourth opt-out does - which is the review
    // moment this test exists to create. Somebody writing a new task
    // query that wants to see steps has to come here and say which one
    // it is and why, in front of whoever reads the diff.
    const named = queries
      .flatMap((q) => [...q.body.matchAll(/subtasks-included:\s*([a-z-]+)/g)].map((m) => m[1]))
      .sort();

    expect(named).toEqual(["the-backup-dump", "the-backup-sheet", "the-steps-of-one-parent"]);

    // And nothing opted out without naming itself.
    const anonymous = queries.filter(
      (q) => q.body.includes("subtasks-included") && !/subtasks-included:\s*[a-z-]+/.test(q.body)
    );
    expect(anonymous.map((q) => `${q.file}:${q.line}`)).toEqual([]);
  });
});

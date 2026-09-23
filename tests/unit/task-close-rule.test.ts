import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// The definition of done is a rule in one function. This test is about
// keeping it that way.
//
// `updateTask` refuses to close a promise the client can see without a
// sentence saying what came of it. That refusal is worth exactly as much
// as the number of ways around it, and the way around it is a direct
// `prisma.task.update` somewhere else - which is easy to write, reads as
// perfectly ordinary, and would produce a client screen showing finished
// work with nothing to show for it. Nobody would notice for a month.
//
// So: one writer. The allowance below is deliberate and narrow, and
// anything new that wants in has to be argued for here rather than
// discovered later.

const ROOT = path.resolve(__dirname, "../..");
const SEARCHED = ["app", "lib"];

/// Writes to the task table that are allowed to bypass updateTask.
///
/// `lib/app-domain/tasks.ts` IS the rule.
///
/// `lib/app-domain/decisions.ts` clears `waitingOnClientSince` when a
/// decision is answered: it touches no status and cannot close anything -
/// it is the client's own answer releasing a promise that was waiting on
/// them.
///
/// `lib/app-domain/important-dates-job.ts` opens a task when a recurring
/// date comes round. It only ever creates OPEN work, so it cannot produce
/// a finished promise with nothing to show for it. If it ever learns to
/// close one, it belongs behind updateTask like everything else.
const ALLOWED = new Set([
  "lib/app-domain/tasks.ts",
  "lib/app-domain/decisions.ts",
  "lib/app-domain/important-dates-job.ts",
]);

const WRITE = /prisma\.task\.(update|updateMany|upsert|create|createMany)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("only one place writes a task", () => {
  it("has no direct task writes outside the domain module", () => {
    const offenders: string[] = [];

    for (const base of SEARCHED) {
      for (const file of walk(path.join(ROOT, base))) {
        const rel = path.relative(ROOT, file);
        if (ALLOWED.has(rel)) continue;
        const source = readFileSync(file, "utf8");
        source.split("\n").forEach((line, i) => {
          if (WRITE.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        });
      }
    }

    expect(
      offenders,
      [
        "A task is written outside lib/app-domain/tasks.ts.",
        "",
        "That module holds the rule that a promise the client can see cannot be",
        "closed without a sentence saying what came of it. A direct write skips it,",
        "and the result is a client reading 'הושלם' next to nothing at all.",
        "",
        "Route the write through createTask/updateTask. If it genuinely cannot go",
        "through them, add it to ALLOWED in this file with a sentence saying why.",
      ].join("\n")
    ).toEqual([]);
  });

  it("states the rule in words the person who hits it can act on", async () => {
    const { NO_OUTCOME_MESSAGE } = await import("@/lib/app-domain/tasks");
    // Not a style check. This string is the whole explanation a person
    // gets when their click is refused, and "Invalid input" here would
    // send them looking for a bug instead of writing one line.
    expect(NO_OUTCOME_MESSAGE).toContain("שורת תוצאה");
    expect(NO_OUTCOME_MESSAGE.length).toBeGreaterThan(40);
  });
});

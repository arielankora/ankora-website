import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Silent failures plan (27.11.2026): in the areas where a failure loses a
// message, a recording or a nightly run, an error written only to the log
// is how failures went unseen for weeks. A failure there goes through
// reportIssue (lib/system-issues.ts) or a nightly step (lib/cron-run.ts).
//
// Stage 1c of the plan (27.11.2026) converted every one: a fault is a
// reportIssue, a diagnostic of a step that is retried is a console.warn.
// A new console.error or an empty catch in these folders fails here.
const LIMITS: Record<string, { consoleError: number; emptyCatch: number }> = {
  "lib/comms": { consoleError: 0, emptyCatch: 0 },
  "lib/whatsapp-poc": { consoleError: 0, emptyCatch: 0 },
  "lib/mail-scan": { consoleError: 0, emptyCatch: 0 },
  "lib/client-mailbox": { consoleError: 0, emptyCatch: 0 },
  "app/api/cron": { consoleError: 0, emptyCatch: 0 },
  "app/api/webhooks": { consoleError: 0, emptyCatch: 0 },
};

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function count(dir: string, pattern: RegExp): number {
  return filesUnder(dir).reduce((n, file) => n + (readFileSync(file, "utf8").match(pattern)?.length ?? 0), 0);
}

describe("no new silent failures where a failure loses something", () => {
  for (const [dir, limit] of Object.entries(LIMITS)) {
    it(`${dir}: no new console.error, no empty catch`, () => {
      expect(count(dir, /console\.error\(/g), "a new console.error: call reportIssue instead").toBeLessThanOrEqual(limit.consoleError);
      expect(count(dir, /catch\s*\{\s*\}|\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/g), "an empty catch swallows a failure").toBeLessThanOrEqual(limit.emptyCatch);
    });
  }
});

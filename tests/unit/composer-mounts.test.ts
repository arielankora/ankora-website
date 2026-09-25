import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The button that writes to a client, on every screen that has a reason
// to, and nowhere a screen can get it wrong.
//
// Ariel, 25.9.2026: nothing goes out to a client automatically, and the
// replacement is a ready message a person edits and sends. That rule is
// enforced in two places - the domain sends nothing, and the screens say
// so - and both halves are source facts rather than behaviour, so this
// reads the source. The repo does this elsewhere (audit-labels,
// subtask-isolation) for the same reason: a rule nobody can see being
// broken is a rule that gets broken.

const ROOTS = ["app", "components", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(r)).map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("the composer's props come from one place", () => {
  it("is mounted only with props the helper built", () => {
    // A screen that assembles these by hand is a screen that can leave
    // out `preferenceNever`, and that field exists for exactly one
    // moment: the one where somebody is about to write to a client who
    // asked them not to.
    const mounts = FILES.filter((f) => f.text.includes("<MessageClient"));
    expect(mounts.length).toBeGreaterThan(0);

    for (const file of mounts) {
      const built = file.text.includes("messageComposerProps");
      const received = file.text.includes("composer: ComposerProps");
      expect(built || received, file.path).toBe(true);
    }
  });

  it("keeps the draft builder and the number parser out of the screens", () => {
    // Both are reachable and both are easy to call directly. Calling
    // them from a screen rebuilds half the helper and skips the half
    // that reads the client's own words.
    for (const file of FILES) {
      if (file.path.endsWith(join("lib", "app-domain", "client-messages.ts"))) continue;
      expect(file.text.includes("buildMessage("), file.path).toBe(false);
      expect(file.text.includes("whatsappDigits("), file.path).toBe(false);
    }
  });
});

describe("no screen claims to have sent something it did not send", () => {
  // Three buttons used to say "שליחה ללקוח" for actions that write a
  // row and stop. A decision appears in the portal; a summary is
  // published there; neither one reaches anybody. The words were true
  // when an email fired from the domain, and stayed on screen after it
  // was removed - which is the failure this protects against, because
  // the person who pressed the button has no way to find out.
  const CLAIMS = ["שליחה ללקוח", "נשלחה ללקוח", "ההחלטה נשלחה"];

  it("does not promise a send from a screen", () => {
    for (const file of FILES) {
      // The audit log is describing a message a person really sent, in
      // the past tense. That one is a record, not a promise.
      if (file.path.includes(join("audit-log", "labels.ts"))) continue;
      for (const claim of CLAIMS) {
        // A comment explaining why the words are gone is not the words
        // coming back.
        const code = file.text
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("{/*"))
          .join("\n");
        expect(code.includes(claim), `${file.path}: ${claim}`).toBe(false);
      }
    }
  });
});

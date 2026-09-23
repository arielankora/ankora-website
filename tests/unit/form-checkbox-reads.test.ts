import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// An unchecked checkbox is not sent at all.
//
// So `formData.get("x") !== "off"` is true for a box nobody ticked, and
// every toggle read that way is decorative: it reports "yes" whatever the
// person did. It reads as defensive - as if it were handling some value
// called "off" - which is why it survived review twice.
//
// Both instances were real. One filed every client document as visible to
// the client with the box unticked, which is a privacy control that did
// nothing. The other added default reminders to important dates that
// asked not to have them. The first was found on the first live upload;
// the second only because it was the same shape.
//
// A grep is the right test for this. There is nothing to unit-test in a
// Server Action that reads a FormData, and the mistake is recognisable by
// its shape rather than by its behaviour.

const ROOTS = ["app", "lib", "components"];
const EXTENSIONS = [".ts", ".tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

describe("checkbox reads", () => {
  it("never decides a checkbox by comparing against anything but its checked value", () => {
    const offending: string[] = [];

    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const source = readFileSync(file, "utf8");
        source.split("\n").forEach((line, i) => {
          // `formData.get(...) !== "..."`: the negative comparison is the
          // fault whatever it is compared to, because null passes it.
          if (/formData\.get\([^)]*\)\s*!==/.test(line)) {
            offending.push(`${file}:${i + 1} ${line.trim()}`);
          }
        });
      }
    }

    expect(offending).toEqual([]);
  });
});

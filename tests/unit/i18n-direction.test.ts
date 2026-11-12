import { describe, expect, it } from "vitest";
import { sourceFiles, sourceStrings } from "../helpers/source-strings";

/**
 * ADR 0006. The app turns left to right for an English reader, and it can
 * only do that if no class pins a side. `ms-2` is "margin at the start of
 * the line": right in Hebrew, left in English. `mr-2` is right in both,
 * which is correct in exactly one of the two languages.
 *
 * The app was already written almost entirely with the logical classes;
 * thirteen physical ones were left when this guard was added, and they were
 * fixed with it. This keeps it that way.
 *
 * A class that has to know the direction says so explicitly, with an
 * `rtl:` or `ltr:` variant, or an arbitrary variant that names `dir=`.
 * Those are allowed, because a person chose the side on purpose.
 */
const PHYSICAL =
  /^-?(?:(?:m|p|scroll-m|scroll-p)[lr]|left|right|rounded-[lr]|rounded-[tb][lr]|border-[lr]|text-left|text-right|float-left|float-right|clear-left|clear-right)(?:-|$)/;

function physicalClasses(text: string): string[] {
  return text.split(/\s+/).filter((token) => {
    if (!token) return false;
    const parts = token.split(":");
    const utility = parts[parts.length - 1].replace(/^!/, "");
    if (!PHYSICAL.test(utility)) return false;
    const variants = parts.slice(0, -1).join(":");
    return !/(^|:)(rtl|ltr)$|(^|:)(rtl|ltr):|dir=/.test(variants);
  });
}

describe("no class pins a physical side (ADR 0006)", () => {
  it("the product app and its components use logical classes", () => {
    const files = [...sourceFiles("app/(product)"), ...sourceFiles("components/app")];
    const offenders: string[] = [];
    for (const file of files) {
      for (const s of sourceStrings(file)) {
        // Class names live in short, space-separated strings; prose that
        // happens to contain "left-" does not have Tailwind's shape.
        for (const cls of physicalClasses(s.text)) offenders.push(`${s.file}:${s.line}  ${cls}`);
      }
    }
    expect(offenders, "Use ms/me, ps/pe, start/end, text-start/text-end, rounded-s/e, border-s/e").toEqual([]);
  });

  it("recognises the classes it is meant to catch, and lets deliberate ones through", () => {
    expect(physicalClasses("mr-2 md:pl-4 text-right left-0 -ml-1 rounded-tl-lg border-r")).toEqual([
      "mr-2",
      "md:pl-4",
      "text-right",
      "left-0",
      "-ml-1",
      "rounded-tl-lg",
      "border-r",
    ]);
    expect(physicalClasses("ms-2 pe-4 text-start start-0 rounded-s border-e")).toEqual([]);
    expect(physicalClasses("rtl:mr-2 ltr:ml-2 [html[dir=rtl]_&]:pl-10")).toEqual([]);
    expect(physicalClasses("left-to-right right-to-left")).toEqual(["left-to-right", "right-to-left"]);
  });
});

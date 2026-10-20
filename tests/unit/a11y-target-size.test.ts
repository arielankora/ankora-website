// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { auditPage } from "../../qa/checks/a11y.mjs";

// The target-size rule (WCAG 2.2 AA, SC 2.5.8), and what it should measure.
//
// Run #510 reported "Target 1x1 below the 24x24 floor" on 48 page and width
// combinations. All 48 were the contact form: six areas, each a 44px-tall
// <label> chip wrapping a checkbox that Tailwind's `sr-only` clips to one
// pixel square. The chip is correct, accessible markup. The rule was
// measuring the clipped input instead of the thing a person points at.
//
// Forty-eight wrong findings in every weekly report is worse than none. The
// file's own note about "305x24 below the 24x24 floor" says why: a reader
// who can see that a finding is nonsense learns to skim past the section,
// and the real findings go with it.

type Rect = { width: number; height: number };

/** jsdom has no layout, so each element is given the box this test means it to have. */
function layout(boxes: (el: Element) => Rect) {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const { width, height } = boxes(this);
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

const sized = (el: Element): Rect => {
  const spec = (el as HTMLElement).dataset?.box;
  if (!spec) return { width: 0, height: 0 };
  const [w, h] = spec.split("x").map(Number);
  return { width: w, height: h };
};

let restore: () => void;
afterEach(() => restore?.());
beforeEach(() => {
  restore = layout(sized);
});

const targets = () => (auditPage() as { targets: { text: string; w: number; h: number }[] }).targets;

describe("what counts as a target", () => {
  it("measures the label, not the clipped input inside it", () => {
    // The contact form's chip, as it is actually written.
    document.body.innerHTML = `
      <label data-box="120x44">
        <input type="checkbox" data-box="1x1" />
        בריאות
      </label>`;
    expect(targets()).toEqual([]);
  });

  it("still reports a chip that really is too small", () => {
    document.body.innerHTML = `
      <label data-box="20x20">
        <input type="checkbox" data-box="1x1" />
        x
      </label>`;
    const out = targets();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ w: 20, h: 20 });
  });

  it("still reports a bare control that is too small, with no label to stand in for it", () => {
    document.body.innerHTML = `<button data-box="12x12" aria-label="close">x</button>`;
    const out = targets();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ w: 12, h: 12 });
  });

  it("leaves a control alone when it is the label", () => {
    // `el.closest("label")` returns the element itself when it is one. Only
    // a wrapping label may stand in, or a <label> with no control inside it
    // would measure itself twice over.
    document.body.innerHTML = `<label data-box="10x10"><a href="#" data-box="10x10">x</a></label>`;
    expect(targets()).toHaveLength(1);
  });

  it("passes a control that is large enough on its own", () => {
    document.body.innerHTML = `<button data-box="44x44">שליחה</button>`;
    expect(targets()).toEqual([]);
  });
});

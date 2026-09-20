import { cn } from "@/lib/utils";

/**
 * The 1px-gap grid pattern (design_handoff_ankora_site/README.md, "The one layout
 * pattern to learn first"): the gap is the divider line, so no per-cell borders and no
 * double-borders. `minCell` matches the design's `minmax(min(100%, Npx), 1fr)` — always
 * keep the `min(100%, …)` wrapper so it doesn't overflow below `minCell`px; this is the
 * whole responsive strategy, no media queries.
 *
 * The line is drawn by a 1px outline on each cell rather than by a background on the
 * container, and that is the C2 fix rather than a detail. A container background is a
 * *surface*: a translucent cell composites onto it, so an `elevated` cell's .04 cream
 * wash was landing on the grid's own .11 wash and lifting the ground to #2D394B, where
 * gold measures 3.77:1 — illegal, and wrong by about a third of a stop for every other
 * foreground too. Cells own their surfaces; the container owns nothing. With the
 * container transparent, that same .04 wash composites onto the page ground at #14233A,
 * where gold measures 5.10:1 and is legal again.
 *
 * Adjacent 1px outlines meet inside the 1px gap and overlap exactly, so the line reads
 * the same as before. It also fixes the second bug the old pattern had: a grid whose
 * item count is not a multiple of its column count left the container background
 * showing through the empty tracks as a lit slab instead of a line.
 */
export function HairlineGrid({
  children,
  className,
  columns,
  minCell = 280,
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * Explicit column tracks as a class string, for the cases where auto-fit picks a
   * count that leaves orphans — six cells auto-fitting to five across strands one on
   * a second row, and the grid's own hairline background then shows through the five
   * empty tracks as a solid slab rather than a line. Pass the breakpoints you want
   * (`[grid-template-columns:…] min-[1024px]:[grid-template-columns:…]`) and the
   * responsive `minmax(min(100%, …))` default is skipped entirely — the inline style
   * would otherwise win over any class.
   */
  columns?: string;
  minCell?: number;
}) {
  return (
    <div
      // items-stretch is CSS grid's own default, but it's made explicit here (rather
      // than left implicit) so a future className override can't silently reintroduce
      // the bug below by adding items-start/items-baseline.
      className={cn(
        // No background and no border: both belong to the cells now. See the note above.
        "grid items-stretch gap-px",
        columns,
        className
      )}
      style={
        columns
          ? undefined
          : { gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minCell}px), 1fr))` }
      }
    >
      {children}
    </div>
  );
}

export function HairlineGridCell({
  children,
  className,
  elevated = false,
  as: Comp = "div",
}: {
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
  as?: React.ElementType;
}) {
  return (
    <Comp
      // h-full: the gap in HairlineGrid IS the divider line (parent bg shows through
      // it as a 1px hairline). When one cell holds less content than its row siblings,
      // its grid item box still stretches to the row's height by default -- but this
      // element is a plain block child of that box, not the box itself, so without an
      // explicit height it only grows to fit its own content. The shortfall exposes
      // the parent's light background as a solid strip instead of a 1px line. h-full
      // makes this element fill its (already-stretched) grid-item parent so the card's
      // own background reaches the row's full height in every case, not just when
      // every sibling happens to hold the same amount of content.
      className={cn(
        // The outline draws the grid line, and it draws it outside the border box, so
        // two neighbours' outlines share the 1px gap rather than doubling it.
        "h-full p-[clamp(22px,3vw,40px)] outline outline-1",
        elevated
          // .18 rather than .11, which is the compensation the C2 ruling prescribes and
          // the measurement earns. An elevated cell used to separate from the page
          // ground by its fill at 1.48:1; composited correctly it is #14233A on #0B1B33,
          // which is 1.09:1 -- no separation at all. The panel now reads by its edge
          // alone, so the edge has to carry it: .11 gives 1.50:1 against the ground and
          // .18 gives 1.88:1, more than the fill ever provided. Definition from edge,
          // not from a second wash: the composited ground stays #14233A, which is the
          // number every contrast figure on this surface is computed against.
          ? "bg-[rgba(243,234,219,0.04)] outline-[rgba(248,244,236,0.18)] backdrop-blur-[16px]"
          : "bg-[rgba(11,27,51,0.5)] outline-[rgba(243,234,219,0.11)] backdrop-blur-[12px]",
        className
      )}
    >
      {children}
    </Comp>
  );
}

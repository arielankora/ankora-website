import { cn } from "@/lib/utils";

/**
 * The 1px-gap grid pattern (design_handoff_ankora_redesign/README.md, "The one
 * layout pattern to learn first"): the gap itself is the divider line, so no
 * per-cell borders and no double-borders. `minCell` matches the design's
 * `minmax(min(100%, Npx), 1fr)` — always keep the `min(100%, …)` wrapper so it
 * doesn't overflow below `minCell`px; this is the whole responsive strategy,
 * no media queries.
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
        "grid items-stretch gap-px bg-[rgba(243,234,219,0.11)] border border-[rgba(243,234,219,0.11)]",
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
        "h-full p-[clamp(22px,3vw,40px)]",
        elevated
          ? "bg-[rgba(243,234,219,0.04)] backdrop-blur-[16px]"
          : "bg-[rgba(11,27,51,0.5)] backdrop-blur-[12px]",
        className
      )}
    >
      {children}
    </Comp>
  );
}

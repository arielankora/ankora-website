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
  minCell = 280,
}: {
  children: React.ReactNode;
  className?: string;
  minCell?: number;
}) {
  return (
    <div
      className={cn("grid gap-px bg-[rgba(243,234,219,0.11)] border border-[rgba(243,234,219,0.11)]", className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minCell}px), 1fr))` }}
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
      className={cn(
        "p-[clamp(22px,3vw,40px)]",
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

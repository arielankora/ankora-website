import { cn } from "@/lib/utils";

/**
 * Glass panel primitive. Values from design_handoff_ankora_redesign/README.md,
 * "Derived values": standard glass fill `rgba(11,27,51,0.5)` + blur 12px;
 * `elevated` uses the lighter `rgba(243,234,219,0.04)` + blur 16px card the spec
 * reserves for panels that sit above other glass (e.g. cards inside a hairline
 * grid cell, popovers). Hover transition on glass is `.35s` per the motion spec.
 */
export function GlassPanel({
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
        "border border-[rgba(243,234,219,0.1)] transition-[background-color,border-color] duration-[350ms] ease-out",
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

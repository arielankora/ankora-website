import { cn } from "@/lib/utils";

/**
 * /he redesign eyebrow: gold mono label with a pulsing gold dot (design_handoff_
 * ankora_redesign/README.md, "Eyebrow / section label" typography row + "Eyebrow dot
 * pulse" motion token). Replaces the pill-shaped Badge for new /he sections -- Badge's
 * border-pill treatment contradicts the "radius 0 everywhere" hard constraint.
 */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-assistant text-[13.5px] font-semibold tracking-[0.05em] text-gold", className)}>
      <span className="h-1.5 w-1.5 shrink-0 animate-eyebrowPulse rounded-full bg-gold" />
      {children}
    </span>
  );
}

import { cn } from "@/lib/utils";

/**
 * Section eyebrow: gold label with a pulsing 6px gold dot (design_handoff_ankora_site/
 * README.md, "Typography" -> Eyebrow row + the `eyebrowPulse` motion token). Replaces
 * the pill-shaped Badge everywhere -- Badge's border-pill treatment contradicts the
 * "radius 0 everywhere" hard constraint.
 *
 * `rtl:tracking-normal` enforces the spec's Hebrew typography rule ("Never apply
 * letter-spacing to Hebrew text"): the eyebrow string is Hebrew on /he and Latin on
 * /en, so keying the tracking off the document direction is exactly right here. Mono
 * keys are NOT handled this way -- a Latin key like BUSINESS OPS keeps its tracking
 * even inside an RTL page, because the rule is about the script, not the direction.
 */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-assistant text-[13.5px] font-semibold tracking-[0.05em] text-gold rtl:tracking-normal", className)}>
      <span className="h-1.5 w-1.5 shrink-0 animate-eyebrowPulse rounded-full bg-gold" />
      {children}
    </span>
  );
}

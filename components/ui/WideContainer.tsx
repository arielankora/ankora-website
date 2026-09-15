import { cn } from "@/lib/utils";

/**
 * /he redesign content wrapper: max-width 1480px per design_handoff_ankora_redesign/
 * README.md, "Spacing" ("Content max-width 1480px, centred"). Separate from the shared
 * Container (1440px, used by /en and untouched here) so /en's layout is never affected.
 */
export function WideContainer({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-wide px-[clamp(18px,4vw,56px)]", className)}>
      {children}
    </div>
  );
}

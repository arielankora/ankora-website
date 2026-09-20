import { WideContainer } from "@/components/ui/WideContainer";
import { cn } from "@/lib/utils";

/**
 * The section wrapper every home and inner-page block sits in: a `.12` hairline
 * divider on top, the spec's vertical rhythm (`clamp(40px, 6vw, 86px)`) and the
 * 1480px content container.
 *
 * It exists so the divider and the rhythm are declared once. Before the de-fork,
 * each section re-declared both, in two locale variants, and they had already
 * drifted apart by a few pixels.
 */
export function SectionShell({
  children,
  className,
  containerClassName,
  divider = true,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  divider?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "py-[clamp(40px,6vw,86px)]",
        divider && "border-t border-[rgba(243,234,219,0.12)]",
        className
      )}
    >
      <WideContainer className={containerClassName}>{children}</WideContainer>
    </section>
  );
}

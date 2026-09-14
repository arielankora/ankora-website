import type { Locale } from "@/content";
import { PageGlow } from "./PageGlow";
import { ScrollProgress } from "./ScrollProgress";

/**
 * Page-level furniture wrapper, `/he`-only (design_handoff_ankora_redesign/README.md,
 * "Page-level furniture present on nearly every page", point 4: `isolation: isolate`,
 * `overflow-x: hidden`, content sits at `position: relative; z-index: 1` above the glow).
 * On /en this is a no-op passthrough — zero visual or behavioural change there.
 */
export function PageShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  if (locale !== "he") return <>{children}</>;

  return (
    <div style={{ isolation: "isolate", overflowX: "hidden" }}>
      <PageGlow />
      <ScrollProgress />
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}

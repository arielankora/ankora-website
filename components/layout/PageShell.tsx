import { PageGlow } from "./PageGlow";
import { ScrollProgress } from "./ScrollProgress";

/**
 * Page-level furniture, present on every page in both locales
 * (design_handoff_ankora_site/README.md, "Ambient background": the two fixed radial
 * glows sit behind the content at z-index 0, content at 10, header at 20).
 *
 * This used to be a /he-only wrapper with an `en` passthrough, from the round where
 * only Hebrew had been redesigned. The site redesign brings both locales onto the same
 * visual language, so the fork is gone and the `locale` prop with it.
 */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ isolation: "isolate", overflowX: "hidden" }}>
      <PageGlow />
      <ScrollProgress />
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}

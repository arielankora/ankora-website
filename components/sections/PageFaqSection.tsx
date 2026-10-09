import type { PageFaqBlock } from "@/content/types";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/motion/Reveal";
import { PageFAQ } from "@/components/sections/PageFAQ";

/**
 * A visible FAQ block for an inner page (pricing, how-it-works, technology).
 *
 * The page's FAQPage JSON-LD is built from the same `faq.items` in its page.tsx,
 * so what answer engines read is exactly what a visitor can open here. The heading
 * follows the pricing page's SectionHead: eyebrow, then a light h2.
 */
export function PageFaqSection({ faq }: { faq: PageFaqBlock }) {
  return (
    <SectionShell>
      <Reveal>
        <Eyebrow>{faq.label}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mt-6 max-w-[24ch] text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
          {faq.title}
        </h2>
      </Reveal>
      <PageFAQ items={faq.items} />
    </SectionShell>
  );
}

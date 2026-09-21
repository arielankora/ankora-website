import Link from "next/link";
import type { Locale } from "@/content";
import type { CustomerStory } from "@/content/customer-stories/types";
import { storiesUi } from "@/content/customer-stories/ui";
import { withLocale } from "@/lib/nav";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Iso, Ltr } from "@/components/ui/Ltr";
import { Reveal } from "@/components/motion/Reveal";

/**
 * The reusable customer-evidence block: home page, the Personal Operations Management
 * page, and the executives/founders solution pages all render this one component.
 *
 * It takes the stories it is given rather than naming one, so it is a component about
 * *evidence*, not about a customer. When story #2 publishes against /solutions/founders,
 * that page's call to getStoriesForSolution returns it and this block shows it, with no
 * edit here and none there.
 *
 * Renders nothing at all when there is no evidence for the context. A proof block with
 * a placeholder in it is worse than no proof block.
 */
export function CustomerProof({
  locale,
  stories,
  heading,
  divider = true,
}: {
  locale: Locale;
  stories: CustomerStory[];
  heading?: string;
  divider?: boolean;
}) {
  if (stories.length === 0) return null;
  const ui = storiesUi(locale);
  const arrow = locale === "he" ? "←" : "→";

  return (
    <SectionShell divider={divider}>
      <Reveal>
        <Eyebrow>{heading ?? ui.proofHeading}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <p className="mt-4 max-w-[60ch] font-assistant text-[1.02rem] font-light leading-[1.8] text-muted">
          {ui.proofLead}
        </p>
      </Reveal>

      <div className="mt-8 flex flex-col gap-px">
        {stories.map((story) => (
          <Reveal key={story.slug}>
            <Link
              href={withLocale(locale, `/customer-stories/${story.slug}`)}
              className="group flex flex-col gap-4 p-[clamp(20px,2.6vw,30px)] outline outline-1 outline-[rgba(243,234,219,0.11)] transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.04)] md:flex-row md:items-center md:justify-between md:gap-10"
            >
              <span className="flex flex-col gap-2">
                <MonoLabel size={10} tracking="0.12em" className="text-gold">
                  <Iso>{story.customerName}</Iso>
                  {story.customerRole ? " · " : ""}
                  {story.customerRole && <Ltr className="text-muted">{story.customerRole}</Ltr>}
                </MonoLabel>
                <span className="text-[clamp(1.15rem,1.8vw,1.5rem)] font-light leading-[1.3] text-cream transition-colors group-hover:text-gold">
                  {story.headline}
                </span>
                <span className="max-w-[62ch] font-assistant text-[15px] font-light leading-[1.7] text-muted">
                  {story.summary}
                </span>
              </span>
              <MonoLabel size={11} aria-hidden className="flex-none text-gold">
                {ui.readStory} {arrow}
              </MonoLabel>
            </Link>
          </Reveal>
        ))}
      </div>

      <div className="mt-5">
        <Link
          href={withLocale(locale, "/customer-stories")}
          className="inline-flex min-h-[44px] items-center transition-colors hover:text-gold"
        >
          <MonoLabel size={11} className="text-muted transition-colors hover:text-gold">
            {ui.proofCta} {arrow}
          </MonoLabel>
        </Link>
      </div>
    </SectionShell>
  );
}

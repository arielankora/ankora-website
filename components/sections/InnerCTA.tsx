import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { WideContainer } from "@/components/ui/WideContainer";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";

/**
 * The closing CTA shared by the inner pages. Same shape and rhythm as the home
 * page's, but the heading can be overridden per page — only the technology page
 * does, asking "want to see how this would work for you?" rather than repeating the
 * home page's line at the end of an explanatory page.
 */
export function InnerCTA({
  dict,
  locale,
  title,
}: {
  dict: Dictionary;
  locale: Locale;
  title?: string;
}) {
  return (
    <section className="relative overflow-hidden border-t border-[rgba(243,234,219,0.12)] py-[clamp(64px,9vw,130px)]">
      <WideContainer className="relative flex flex-col items-center gap-5 text-center">
        <Reveal>
          <h2 className="mx-auto max-w-[18ch] text-balance text-[clamp(2rem,4.4vw,3.6rem)] font-extralight leading-[1.1] tracking-[-0.03em] text-paper">
            {title ?? dict.finalCta.title}
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mx-auto font-assistant text-[1.05rem] font-light text-tone-muted">
            {dict.finalCta.body}
          </p>
        </Reveal>
        <Reveal delay={0.2} className="mt-5 flex justify-center">
          <Button href={withLocale(locale, "/contact")}>{dict.finalCta.cta}</Button>
        </Reveal>
      </WideContainer>
    </section>
  );
}

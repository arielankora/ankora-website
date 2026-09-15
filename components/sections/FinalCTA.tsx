import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";

// /he redesign: home page closing CTA, centred, H1-scale H2 (design_handoff_ankora_
// redesign/README.md).
function HeFinalCTA({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <section className="relative overflow-hidden border-t border-[rgba(243,234,219,0.12)] py-[clamp(44px,7vw,112px)]">
      <WideContainer className="relative text-center">
        <Reveal>
          <h2 className="mx-auto max-w-2xl text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-paper">
            {dict.finalCta.title}
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mx-auto mt-5 max-w-md font-assistant text-[#A9B8C9]">{dict.finalCta.body}</p>
        </Reveal>
        <Reveal delay={0.2} className="mt-10 flex justify-center">
          <Button href={withLocale(locale, "/contact")}>{dict.finalCta.cta}</Button>
        </Reveal>
      </WideContainer>
    </section>
  );
}

export function FinalCTA({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  if (locale === "he") {
    return <HeFinalCTA dict={dict} locale={locale} />;
  }

  return (
    <section className="relative overflow-hidden bg-ink py-28 md:py-40">
      <div className="absolute inset-0 bg-radial-glow" />
      <Container className="relative text-center">
        <Reveal>
          <h2 className="mx-auto max-w-2xl text-[32px] font-medium leading-[1.15] tracking-tight text-paper md:text-[52px]">
            {dict.finalCta.title}
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mx-auto mt-5 max-w-md text-paper/55">{dict.finalCta.body}</p>
        </Reveal>
        <Reveal delay={0.2} className="mt-10 flex justify-center">
          <Button href={withLocale(locale, "/contact")}>{dict.finalCta.cta}</Button>
        </Reveal>
      </Container>
    </section>
  );
}

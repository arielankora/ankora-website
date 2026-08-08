import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";

export function FinalCTA({ dict, locale }: { dict: Dictionary; locale: Locale }) {
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

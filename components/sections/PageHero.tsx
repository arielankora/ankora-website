import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/motion/Reveal";

// /he redesign: inner-page hero, per design_handoff_ankora_redesign/README.md typography
// table ("H1 inner page", clamp(2.2rem,5.2vw,4.7rem), weight 200). Locale is inferred from
// the `he` prop rather than threaded through every call site's props type, since PageHero
// is used from ~10 page components.
function HePageHero({
  eyebrow,
  title,
  sub,
  breadcrumb,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden pb-16 pt-40 md:pb-20 md:pt-48">
      <WideContainer className="relative z-[1]">
        {breadcrumb && <div className="mb-8">{breadcrumb}</div>}
        <Reveal><Eyebrow>{eyebrow}</Eyebrow></Reveal>
        <Reveal delay={0.08}>
          <h1 className="mt-6 max-w-3xl text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-paper">
            {title}
          </h1>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-6 max-w-xl font-assistant text-lg leading-relaxed text-[#D8CAB5]">{sub}</p>
        </Reveal>
      </WideContainer>
    </section>
  );
}

export function PageHero({
  eyebrow,
  title,
  sub,
  breadcrumb,
  locale,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  breadcrumb?: React.ReactNode;
  locale?: "he" | "en";
}) {
  if (locale === "he") {
    return <HePageHero eyebrow={eyebrow} title={title} sub={sub} breadcrumb={breadcrumb} />;
  }

  return (
    <section className="relative overflow-hidden bg-ink pb-20 pt-40 md:pb-28 md:pt-48">
      <div className="absolute inset-0 bg-radial-glow opacity-70" />
      <Container className="relative">
        {breadcrumb && <div className="mb-8">{breadcrumb}</div>}
        <Reveal><Badge>{eyebrow}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h1 className="mt-6 max-w-3xl text-[34px] font-medium leading-[1.15] tracking-tight text-paper md:text-[56px]">
            {title}
          </h1>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-paper/55">{sub}</p>
        </Reveal>
      </Container>
    </section>
  );
}

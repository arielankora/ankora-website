import { WideContainer } from "@/components/ui/WideContainer";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/motion/Reveal";

/**
 * Inner-page hero: breadcrumb, eyebrow, H1, lead. One implementation for both
 * locales — the `locale` prop that used to pick between a Hebrew and an English
 * treatment is gone, and with it the `Badge`-and-lighter-type variant /en was on.
 */
export function PageHero({
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
        <Reveal>
          <Eyebrow>{eyebrow}</Eyebrow>
        </Reveal>
        <Reveal delay={0.08}>
          <h1 className="mt-6 max-w-3xl text-balance text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.1] tracking-[-0.03em] text-cream">
            {title}
          </h1>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-6 max-w-[56ch] font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-body">
            {sub}
          </p>
        </Reveal>
      </WideContainer>
    </section>
  );
}

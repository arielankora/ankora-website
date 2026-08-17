import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Reveal } from "@/components/motion/Reveal";

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

import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Reveal } from "@/components/motion/Reveal";

export function HumanAI({ dict }: { dict: Dictionary }) {
  return (
    <section className="bg-navy py-24 md:py-36">
      <Container>
        <Reveal><Badge>{dict.humanAI.label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
            {dict.humanAI.title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 max-w-xl text-paper/50">{dict.humanAI.body}</p>
        </Reveal>

        <div className="mt-16 grid gap-6 md:grid-cols-2">
          <Reveal delay={0.1} className="rounded-2xl border border-line p-10">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/40">{dict.humanAI.humanTitle}</span>
            <ul className="mt-6 flex flex-wrap gap-3">
              {dict.humanAI.human.map((h) => (
                <li key={h} className="rounded-full border border-line px-4 py-2 text-sm text-paper/80">{h}</li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.18} className="rounded-2xl border border-lineGold/40 bg-white/[0.02] p-10">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-light/80">{dict.humanAI.aiTitle}</span>
            <ul className="mt-6 flex flex-wrap gap-3">
              {dict.humanAI.ai.map((a) => (
                <li key={a} className="rounded-full border border-lineGold/40 px-4 py-2 text-sm text-gold-light">{a}</li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

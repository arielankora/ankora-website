import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Reveal } from "@/components/motion/Reveal";

// /he redesign: home page "אדם + AI" -- two lists side by side, gold heads over
// hairlines (design_handoff_ankora_redesign/README.md).
function HeHumanAI({ dict }: { dict: Dictionary }) {
  return (
    <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
      <WideContainer>
        <Reveal><Eyebrow>{dict.humanAI.label}</Eyebrow></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
            {dict.humanAI.title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 max-w-xl font-assistant text-[#A9B8C9]">{dict.humanAI.body}</p>
        </Reveal>

        <div
          className="mt-14 grid gap-6"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}
        >
          <Reveal delay={0.1}>
            <GlassPanel elevated className="p-[clamp(22px,3vw,40px)]">
              <span className="border-b border-[rgba(243,234,219,0.16)] pb-3 text-[13px] font-semibold tracking-[0.04em] text-gold">
                {dict.humanAI.humanTitle}
              </span>
              <ul className="mt-5 space-y-3">
                {dict.humanAI.human.map((h) => (
                  <li key={h} className="flex items-center gap-2.5 text-sm text-paper">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-[#7C8EA3]" />
                    {h}
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </Reveal>
          <Reveal delay={0.18}>
            <GlassPanel elevated className="border-[rgba(176,141,87,0.35)] bg-[rgba(176,141,87,0.09)] p-[clamp(22px,3vw,40px)]">
              <span className="border-b border-[rgba(176,141,87,0.35)] pb-3 text-[13px] font-semibold tracking-[0.04em] text-gold">
                {dict.humanAI.aiTitle}
              </span>
              <ul className="mt-5 space-y-3">
                {dict.humanAI.ai.map((a) => (
                  <li key={a} className="flex items-center gap-2.5 text-sm text-paper">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-gold" />
                    {a}
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </Reveal>
        </div>
      </WideContainer>
    </section>
  );
}

export function HumanAI({ dict, locale }: { dict: Dictionary; locale?: "he" | "en" }) {
  if (locale === "he") {
    return <HeHumanAI dict={dict} />;
  }

  return (
    <section className="bg-paper py-24 md:py-36">
      <Container>
        <Reveal><Badge tone="light">{dict.humanAI.label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-navy md:text-[42px]">
            {dict.humanAI.title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 max-w-xl text-navy/60">{dict.humanAI.body}</p>
        </Reveal>

        <div className="mt-16 grid gap-6 md:grid-cols-2">
          <Reveal delay={0.1} className="rounded-2xl border border-lineDark bg-cream/60 p-10">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-navy/45">{dict.humanAI.humanTitle}</span>
            <ul className="mt-6 flex flex-wrap gap-3">
              {dict.humanAI.human.map((h) => (
                <li key={h} className="rounded-full border border-lineDark px-4 py-2 text-sm text-navy/80">{h}</li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.18} className="rounded-2xl border border-gold/40 bg-cream/60 p-10">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">{dict.humanAI.aiTitle}</span>
            <ul className="mt-6 flex flex-wrap gap-3">
              {dict.humanAI.ai.map((a) => (
                <li key={a} className="rounded-full border border-gold/40 px-4 py-2 text-sm text-gold">{a}</li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

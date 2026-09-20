import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/motion/Reveal";

/**
 * The three editorial beats on the home page — the problem, the insight, the new
 * category. Eyebrow, then a two-column split: H2 on the start side, body on the end
 * side, separated by the section hairline.
 *
 * The `tone` prop is gone. It used to alternate cream and navy backgrounds on /en;
 * every page ground is navy now, in both locales, so there is nothing left to
 * alternate.
 */
export function EditorialSection({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <SectionShell>
      <Reveal>
        <Eyebrow>{label}</Eyebrow>
      </Reveal>
      <div
        className="mt-8 grid gap-10"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}
      >
        <Reveal delay={0.08}>
          <h2 className="max-w-xl text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-paper">
            {title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="max-w-2xl font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-tone-body">
            {body}
          </p>
        </Reveal>
      </div>
    </SectionShell>
  );
}

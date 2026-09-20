import type { Dictionary } from "@/content";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/motion/Reveal";

function DottedList({
  label,
  items,
  dotClass,
  ruleClass,
}: {
  label: string;
  items: string[];
  dotClass: string;
  ruleClass: string;
}) {
  return (
    <div>
      <div
        className={`border-b pb-3 font-assistant text-[13px] font-semibold tracking-[0.04em] text-gold rtl:tracking-normal ${ruleClass}`}
      >
        {label}
      </div>
      <div className="mt-4 flex flex-col gap-[11px]">
        {items.map((item) => (
          <div key={item} className="flex items-center gap-2.5 font-assistant text-sm font-light text-paper">
            <span className={`h-1 w-1 shrink-0 rounded-full ${dotClass}`} />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Human + AI: a single full-width glass panel holding both lists side by side.
 *
 * One panel, not two. The point of the section is that the two halves are one thing;
 * giving each its own bordered card would draw the line the copy is arguing against,
 * and it also removed the equal-height problem the two lists (five items against six)
 * used to create.
 *
 * The only colour difference between the columns is the dot and the rule: grey for
 * what people bring, gold for what the system brings. Gold has one job here.
 */
export function HumanAI({ dict }: { dict: Dictionary }) {
  return (
    <SectionShell>
      <Reveal>
        <div className="border border-[rgba(243,234,219,0.11)] bg-[rgba(243,234,219,0.04)] p-[clamp(28px,4vw,56px)] backdrop-blur-[16px]">
          <Eyebrow>{dict.humanAI.label}</Eyebrow>
          <h2 className="mt-6 text-[clamp(1.7rem,2.8vw,2.6rem)] font-extralight leading-[1.16] tracking-[-0.02em] text-paper">
            {dict.humanAI.title}
          </h2>
          <p className="mb-8 mt-[18px] max-w-[48ch] font-assistant font-light leading-[1.8] text-tone-body">
            {dict.humanAI.body}
          </p>

          <div
            className="grid gap-7"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))" }}
          >
            <DottedList
              label={dict.humanAI.humanTitle}
              items={dict.humanAI.human}
              dotClass="bg-tone-dim"
              ruleClass="border-[rgba(243,234,219,0.16)]"
            />
            <DottedList
              label={dict.humanAI.aiTitle}
              items={dict.humanAI.ai}
              dotClass="bg-gold"
              ruleClass="border-[rgba(176,141,87,0.35)]"
            />
          </div>
        </div>
      </Reveal>
    </SectionShell>
  );
}

import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils";

// /he redesign: the three home "story sections" (הבעיה / התובנה / קטגוריה חדשה), per
// design_handoff_ankora_redesign/README.md -- a border-top hairline, gold mono eyebrow,
// then a two-column auto-fit row (H2 left, body right). The cream/navy alternating
// rhythm is retired for /he (this is a full redesign, not a refresh) -- every section is
// navy/glass now, so the `tone` prop is ignored on /he and every instance renders the
// same way regardless of which tone the caller passed.
function HeEditorialSection({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
      <WideContainer>
        <Reveal>
          <Eyebrow>{label}</Eyebrow>
        </Reveal>
        <div
          className="mt-8 grid gap-10"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}
        >
          <Reveal delay={0.08}>
            <h2 className="max-w-xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
              {title}
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p className="max-w-2xl font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-[#C3CEDA]">
              {body}
            </p>
          </Reveal>
        </div>
      </WideContainer>
    </section>
  );
}

export function EditorialSection({
  label,
  title,
  body,
  tone = "light",
  locale,
}: {
  label: string;
  title: string;
  body: string;
  tone?: "light" | "dark";
  locale?: "he" | "en";
}) {
  if (locale === "he") {
    return <HeEditorialSection label={label} title={title} body={body} />;
  }

  const isLight = tone === "light";
  return (
    <section className={cn("py-24 md:py-36", isLight ? "bg-cream" : "bg-navy")}>
      <Container>
        <Reveal>
          <Badge tone={isLight ? "light" : "dark"}>{label}</Badge>
        </Reveal>
        <Reveal delay={0.08}>
          <h2
            className={cn(
              "mt-6 max-w-3xl text-[28px] font-medium leading-[1.2] tracking-tight md:text-[42px]",
              isLight ? "text-navy" : "text-paper"
            )}
          >
            {title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p
            className={cn(
              "mt-6 max-w-2xl text-base leading-relaxed md:text-lg",
              isLight ? "text-navy/60" : "text-paper/55"
            )}
          >
            {body}
          </p>
        </Reveal>
      </Container>
    </section>
  );
}

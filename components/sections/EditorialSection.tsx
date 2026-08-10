import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils";

export function EditorialSection({
  label,
  title,
  body,
  tone = "light",
}: {
  label: string;
  title: string;
  body: string;
  tone?: "light" | "dark";
}) {
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

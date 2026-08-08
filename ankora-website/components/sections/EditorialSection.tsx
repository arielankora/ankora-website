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
  return (
    <section className={cn("py-24 md:py-36", tone === "dark" ? "bg-ink" : "bg-navy")}>
      <Container>
        <Reveal>
          <Badge>{label}</Badge>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-3xl text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
            {title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-paper/55 md:text-lg">{body}</p>
        </Reveal>
      </Container>
    </section>
  );
}

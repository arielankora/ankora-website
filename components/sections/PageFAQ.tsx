"use client";

import { useState } from "react";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Reveal } from "@/components/motion/Reveal";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function PageFAQ({
  label,
  title,
  items,
  tone = "light",
}: {
  label: string;
  title: string;
  items: { q: string; a: string }[];
  tone?: "light" | "dark";
}) {
  const [open, setOpen] = useState<number | null>(0);
  const isLight = tone === "light";

  return (
    <section className={cn("py-24 md:py-36", isLight ? "bg-paper" : "bg-navy")}>
      <Container className="max-w-3xl">
        <Reveal><Badge tone={isLight ? "light" : "dark"}>{label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2
            className={cn(
              "mt-6 text-[28px] font-medium leading-[1.2] tracking-tight md:text-[38px]",
              isLight ? "text-navy" : "text-paper"
            )}
          >
            {title}
          </h2>
        </Reveal>

        <div className={cn("mt-12 divide-y border-y", isLight ? "divide-lineDark border-lineDark" : "divide-line border-line")}>
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between py-6 text-start"
                  aria-expanded={isOpen}
                >
                  <span className={cn("text-base font-medium md:text-lg", isLight ? "text-navy" : "text-paper")}>
                    {item.q}
                  </span>
                  <span
                    className={cn(
                      "ms-6 shrink-0 text-xl text-gold transition-transform duration-300",
                      isOpen && "rotate-45"
                    )}
                  >
                    +
                  </span>
                </button>
                {/* Answers stay mounted at all times so every FAQ answer is present in the
                    server-rendered HTML, not only the one open by default. */}
                <motion.div
                  initial={false}
                  animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <p className={cn("pb-6 text-sm leading-relaxed md:text-base", isLight ? "text-navy/60" : "text-paper/55")}>
                    {item.a}
                  </p>
                </motion.div>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}

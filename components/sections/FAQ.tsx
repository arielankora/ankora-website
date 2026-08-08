"use client";

import { useState } from "react";
import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Reveal } from "@/components/motion/Reveal";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function FAQ({ dict }: { dict: Dictionary }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="bg-navy py-24 md:py-36">
      <Container className="max-w-3xl">
        <Reveal><Badge>{dict.faq.label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[38px]">
            {dict.faq.title}
          </h2>
        </Reveal>

        <div className="mt-12 divide-y divide-line border-y border-line">
          {dict.faq.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between py-6 text-start"
                  aria-expanded={isOpen}
                >
                  <span className="text-base font-medium text-paper md:text-lg">{item.q}</span>
                  <span
                    className={cn(
                      "ms-6 shrink-0 text-xl text-gold-light transition-transform duration-300",
                      isOpen && "rotate-45"
                    )}
                  >
                    +
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="pb-6 text-sm leading-relaxed text-paper/55 md:text-base">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}

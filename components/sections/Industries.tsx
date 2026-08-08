"use client";

import type { Dictionary, Locale } from "@/content";
import Link from "next/link";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

export function Industries({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <section className="bg-ink py-24 md:py-36">
      <Container>
        <Reveal><Badge>{dict.industries.label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
            {dict.industries.title}
          </h2>
        </Reveal>

        <RevealStagger className="mt-16 grid gap-4 md:grid-cols-2">
          {dict.industries.items.map((item) => (
            <motion.div key={item.title} variants={staggerItem}>
              <Link
                href={withLocale(locale, item.href)}
                className="group flex items-center justify-between rounded-2xl border border-line p-8 transition-colors hover:border-lineGold hover:bg-white/[0.02]"
              >
                <div>
                  <h3 className="text-xl font-medium text-paper">{item.title}</h3>
                  <p className="mt-2 text-sm text-paper/50">{item.body}</p>
                </div>
                <span className="text-gold-light opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180">→</span>
              </Link>
            </motion.div>
          ))}
        </RevealStagger>
      </Container>
    </section>
  );
}
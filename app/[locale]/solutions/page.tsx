"use client";

import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";
import Link from "next/link";
import { motion } from "framer-motion";

export default function SolutionsIndexPage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.solutionsIndex;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />
      <section className="bg-cream py-20 md:py-28">
        <Container>
          <RevealStagger className="grid gap-4 md:grid-cols-2">
            {dict.industries.items.map((item) => (
              <motion.div key={item.href} variants={staggerItem}>
                <Link
                  href={withLocale(locale, item.href)}
                  className="group flex items-center justify-between rounded-2xl border border-lineDark bg-paper p-8 transition-colors hover:border-gold/50"
                >
                  <div>
                    <h3 className="text-xl font-medium text-navy">{item.title}</h3>
                    <p className="mt-2 text-sm text-navy/55">{item.body}</p>
                  </div>
                  <span className="text-gold opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180">→</span>
                </Link>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>
    </>
  );
}

import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { WideContainer } from "@/components/ui/WideContainer";
import { Reveal } from "@/components/motion/Reveal";
import { ContactForm } from "@/components/sections/ContactForm";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MonoLabel } from "@/components/ui/MonoLabel";

// Both locales get a dedicated title and description. The Hebrew pair was added during
// Ariel's production QA pass; English was left on the generic site meta at the time
// because there was no English copy to write it from. There is now, and a conversion
// page inheriting the homepage title is a real search cost, so /en no longer falls back.
const PAGE_META = {
  he: {
    title: "שיחת היכרות | Ankora",
    description:
      "קבעו שיחת היכרות של עשרים דקות עם Ankora. בלי מחויבות, בלי טפסים ארוכים, כדי להבין איך ניהול תפעול אישי יכול לעבוד עבורכם.",
  },
  en: {
    title: "Book a Call | Ankora",
    description:
      "A twenty-minute call with Ankora. No commitment and no long forms \u2014 we get to know you, understand your needs, and show you how personal operations management could work for you.",
  },
} as const;

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const meta = PAGE_META[locale];
  return {
    title: meta.title,
    description: meta.description,
    openGraph: { title: meta.title, description: meta.description, type: "website" },
    alternates: {
      canonical: `/${locale}/contact`,
      languages: { he: "/he/contact", en: "/en/contact" },
    },
  };
}

/**
 * Contact: the direct details on one side, the four-field form on the other.
 *
 * Like the about page, it writes its own hero instead of using PageHero — the hero
 * and the form share one two-column grid, so the form sits beside the headline rather
 * than below a full-width hero band.
 */
export default async function ContactPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.contact;

  return (
    <>
      <section className="relative overflow-hidden pb-16 pt-40 md:pb-20 md:pt-48">
        <WideContainer className="relative z-[1]">
          <div className="mb-8">
            <Breadcrumbs
              locale={locale}
              items={[{ label: dict.nav.home, href: "/" }, { label: p.eyebrow }]}
            />
          </div>
          <div
            className="grid gap-12 lg:items-start"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))" }}
          >
            <div>
              <Reveal>
                <Eyebrow>{p.eyebrow}</Eyebrow>
              </Reveal>
              <Reveal delay={0.08}>
                <h1 className="mt-6 text-balance text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.1] tracking-[-0.03em] text-paper">
                  {p.title}
                </h1>
              </Reveal>
              <Reveal delay={0.16}>
                <p className="mt-6 max-w-[48ch] font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-tone-body">
                  {p.sub}
                </p>
              </Reveal>
              <Reveal delay={0.22}>
                <div className="mt-10 border-t border-[rgba(243,234,219,0.12)] pt-8">
                  <MonoLabel tracking="0.15em" className="text-tone-muted">
                    {p.directTitle}
                  </MonoLabel>
                  <p className="mt-3 font-assistant text-sm font-light leading-[1.8] text-tone-muted">
                    {p.directBody}
                  </p>
                  <a
                    href="mailto:hello@ankora.co.il"
                    dir="ltr"
                    className="mt-3 inline-flex min-h-[46px] items-center font-jbmono text-sm text-gold underline decoration-[rgba(176,141,87,0.45)] underline-offset-4 transition-colors hover:text-paper"
                  >
                    hello@ankora.co.il
                  </a>
                  <ul className="mt-6 flex flex-col gap-2.5">
                    {p.directPoints.map((point) => (
                      <li key={point} className="flex items-center gap-2.5 font-assistant text-sm font-light text-paper">
                        <span className="h-1 w-1 shrink-0 rounded-full bg-gold" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
            <Reveal delay={0.1}>
              <ContactForm p={p} />
            </Reveal>
          </div>
        </WideContainer>
      </section>

      <InnerCTA dict={dict} locale={locale} />
    </>
  );
}

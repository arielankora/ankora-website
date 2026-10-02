import type { Metadata } from "next";
import { ogBase } from "@/lib/seo-meta";
import { getDictionary, type Locale } from "@/content";
import { WideContainer } from "@/components/ui/WideContainer";
import { Reveal } from "@/components/motion/Reveal";
import { ContactForm } from "@/components/sections/ContactForm";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import Image from "next/image";
import { Eyebrow } from "@/components/ui/Eyebrow";

// Both locales get a dedicated title and description. The Hebrew pair was added during
// Ariel's production QA pass; English was left on the generic site meta at the time
// because there was no English copy to write it from. There is now, and a conversion
// page inheriting the homepage title is a real search cost, so /en no longer falls back.
const PAGE_META = {
  he: {
    title: "שיחת היכרות | Ankora",
    description:
      "קבעו שיחת היכרות אישית של עשרים דקות עם מנכ״ל Ankora. בלי מחויבות: חוזרים אליכם בוואטסאפ, בטלפון או במייל תוך יום עסקים.",
  },
  en: {
    title: "Book a Call | Ankora",
    description:
      "A personal twenty-minute call with Ankora's CEO. No commitment: we reply on WhatsApp, by phone or by email within one business day.",
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
    openGraph: {
      ...ogBase(locale, `/contact`), title: meta.title, description: meta.description, type: "website" },
    alternates: {
      canonical: `/${locale}/contact`,
      languages: { he: "/he/contact", en: "/en/contact", "x-default": "/he/contact" },
    },
  };
}

/**
 * Contact, redesigned 2.10.2026 (claude/contact-page-redesign-2026-10.md).
 *
 * Three blocks in one grid: the intro (headline and who you will speak to), the
 * form, and "what happens next". On a phone they stack in that order, so the
 * form starts on the first screen (it used to start at 795px of an 844px
 * screen). On a wide screen the intro and the steps share the first column and
 * the form takes the second.
 *
 * The closing CTA banner is gone: on this page it linked to this page.
 */
export default async function ContactPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.contact;
  const areas = dict.capabilities.items.map((item) => item.title);

  return (
    <section className="relative overflow-hidden pb-20 pt-28 md:pb-28 md:pt-40">
      <WideContainer className="relative z-[1]">
        <div className="mb-6 hidden md:block">
          <Breadcrumbs locale={locale} items={[{ label: dict.nav.home, href: "/" }, { label: p.eyebrow }]} />
        </div>
        <div className="grid gap-x-[clamp(40px,6vw,88px)] gap-y-8 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:items-start">
          <div className="lg:col-start-1 lg:row-start-1">
            <Reveal>
              <Eyebrow>{p.eyebrow}</Eyebrow>
            </Reveal>
            <Reveal delay={0.08}>
              <h1 className="mt-4 text-balance text-[clamp(2rem,5vw,3.6rem)] font-extralight leading-[1.1] tracking-[-0.02em] text-cream md:mt-6">
                {p.title}
              </h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-4 hidden max-w-[46ch] font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-body md:block">
                {p.sub}
              </p>
            </Reveal>
            <Reveal delay={0.16}>
              <div className="mt-5 flex items-center gap-3.5 md:mt-8">
                <Image
                  src="/team/ariel-utnik.jpg"
                  alt=""
                  width={56}
                  height={56}
                  className="h-11 w-11 border border-[rgba(176,141,87,0.5)] object-cover grayscale md:h-14 md:w-14"
                />
                <div>
                  <p className="text-[15px] text-cream">{p.hostName}</p>
                  <p className="mt-0.5 font-assistant text-sm text-[rgba(248,244,236,0.55)]">{p.hostRole}</p>
                </div>
              </div>
            </Reveal>
          </div>

          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <ContactForm p={p} areas={areas} locale={locale} />
          </div>

          <Reveal className="lg:col-start-1 lg:row-start-2">
            <ol className="grid grid-cols-3 gap-px border border-[rgba(243,234,219,0.12)] bg-[rgba(243,234,219,0.12)]">
              {p.steps.map((step, i) => (
                <li key={step.title} className="bg-navy p-3.5 sm:p-5">
                  <span className="font-jbmono text-[13px] text-gold-light">{String(i + 1).padStart(2, "0")}</span>
                  <p className="mt-2 text-sm leading-snug text-cream sm:mt-2.5 sm:text-[15px]">{step.title}</p>
                  <p className="mt-1 font-assistant text-[13px] leading-snug text-[rgba(248,244,236,0.55)] sm:text-sm">{step.body}</p>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </WideContainer>
    </section>
  );
}

import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Reveal } from "@/components/motion/Reveal";
import { ContactForm } from "@/components/sections/ContactForm";

// /he: dedicated title/description so this conversion page doesn't fall back to the
// generic site meta (flagged and fixed per Ariel's production QA pass). /en keeps its
// prior behaviour (no override) -- untouched, per project convention.
const heMeta = {
  title: "שיחת היכרות | Ankora",
  description:
    "קבעו שיחת היכרות של עשרים דקות עם Ankora. בלי מחויבות, בלי טפסים ארוכים, כדי להבין איך ניהול תפעול אישי יכול לעבוד עבורכם.",
};

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const meta =
    locale === "he"
      ? { title: heMeta.title, description: heMeta.description }
      : {};
  return {
    ...meta,
    alternates: {
      canonical: `/${locale}/contact`,
      languages: { he: "/he/contact", en: "/en/contact" },
    },
  };
}

function HeContactPage({ locale, p }: { locale: Locale; p: ReturnType<typeof getDictionary>["pages"]["contact"] }) {
  return (
    <>
      <section className="relative overflow-hidden pb-16 pt-40 md:pb-20 md:pt-48">
        <WideContainer className="relative z-[1]">
          <div className="grid gap-12 lg:items-start" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))" }}>
            <div>
              <Reveal>
                <span className="font-jbmono text-[12px] tracking-[0.15em] text-gold">{p.eyebrow}</span>
              </Reveal>
              <Reveal delay={0.08}>
                <h1 className="mt-6 text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-paper">
                  {p.title}
                </h1>
              </Reveal>
              <Reveal delay={0.16}>
                <p className="mt-6 max-w-md font-assistant text-lg leading-relaxed text-[#D8CAB5]">{p.sub}</p>
              </Reveal>
              <Reveal delay={0.22}>
                <div className="mt-10 border-t border-[rgba(243,234,219,0.12)] pt-8">
                  <h3 className="font-jbmono text-[12px] tracking-[0.15em] text-[#7C8EA3]">{p.directTitle}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#A9B8C9]">{p.directBody}</p>
                  <a
                    href="mailto:hello@ankora.co.il"
                    className="mt-4 block font-jbmono text-sm text-gold underline decoration-[rgba(176,141,87,0.45)] underline-offset-4 hover:text-paper"
                  >
                    hello@ankora.co.il
                  </a>
                </div>
              </Reveal>
            </div>
            <Reveal delay={0.1}>
              <ContactForm p={p} locale="he" />
            </Reveal>
          </div>
        </WideContainer>
      </section>
    </>
  );
}

export default async function ContactPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.contact;

  if (locale === "he") {
    return <HeContactPage locale={locale} p={p} />;
  }

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />
      <section className="bg-cream py-16 md:py-24">
        <Container className="grid gap-12 lg:grid-cols-[1.3fr_1fr]">
          <Reveal>
            <ContactForm p={p} />
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-2xl border border-gold/40 bg-paper p-8">
              <h3 className="text-lg font-medium text-gold">{p.directTitle}</h3>
              <p className="mt-3 text-sm leading-relaxed text-navy/60">{p.directBody}</p>
              <a href="mailto:hello@ankora.co.il" className="mt-5 block text-navy underline decoration-gold/50 underline-offset-4">
                hello@ankora.co.il
              </a>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}

import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/motion/Reveal";
import { ContactForm } from "@/components/sections/ContactForm";

export default function ContactPage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.contact;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />
      <section className="bg-navy py-16 md:py-24">
        <Container className="grid gap-12 lg:grid-cols-[1.3fr_1fr]">
          <Reveal>
            <ContactForm p={p} />
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-2xl border border-lineGold/40 bg-white/[0.02] p-8">
              <h3 className="text-lg font-medium text-gold-light">{p.directTitle}</h3>
              <p className="mt-3 text-sm leading-relaxed text-paper/55">{p.directBody}</p>
              <a href="mailto:hello@ankora.co.il" className="mt-5 block text-paper underline decoration-lineGold underline-offset-4">
                hello@ankora.co.il
              </a>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}

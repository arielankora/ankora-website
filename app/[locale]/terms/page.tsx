import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/motion/Reveal";

export default function TermsPage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const legal = dict.pages.legal;
  return (
    <>
      <PageHero eyebrow={dict.footer.terms} title={legal.termsTitle} sub={legal.termsPlaceholder} />
      <section className="bg-cream py-20 md:py-28">
        <Container className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-navy/45">{legal.updated}</p>
          <div className="mt-10 space-y-10">
            {legal.termsSections.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.04}>
                <h3 className="text-lg font-medium text-navy">{s.title}</h3>
                <p className="mt-3 leading-relaxed text-navy/60">{s.body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}

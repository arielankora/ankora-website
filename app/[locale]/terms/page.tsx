import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";

export default function TermsPage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  return <PageHero eyebrow={dict.footer.terms} title={dict.pages.legal.termsTitle} sub={dict.pages.legal.placeholder} />;
}

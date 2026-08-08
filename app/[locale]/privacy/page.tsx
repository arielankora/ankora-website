import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";

export default function PrivacyPage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  return <PageHero eyebrow={dict.footer.privacy} title={dict.pages.legal.privacyTitle} sub={dict.pages.legal.placeholder} />;
}

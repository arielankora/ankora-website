import { getDictionary, type Locale } from "@/content";
import { SegmentPage } from "@/components/sections/SegmentPage";

export default function Page({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  return <SegmentPage content={dict.pages.segments.founders} locale={locale} cta={dict.hero.ctaPrimary} />;
}

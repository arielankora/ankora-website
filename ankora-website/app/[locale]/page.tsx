import { getDictionary, type Locale } from "@/content";
import { Hero } from "@/components/sections/Hero";
import { EditorialSection } from "@/components/sections/EditorialSection";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Intelligence } from "@/components/sections/Intelligence";
import { Capabilities } from "@/components/sections/Capabilities";
import { HumanAI } from "@/components/sections/HumanAI";
import { Industries } from "@/components/sections/Industries";
import { Trust } from "@/components/sections/Trust";
import { FAQ } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/FinalCTA";

export default function Home({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);

  return (
    <>
      <Hero dict={dict} locale={locale} />
      <EditorialSection label={dict.problem.label} title={dict.problem.title} body={dict.problem.body} tone="light" />
      <EditorialSection label={dict.insight.label} title={dict.insight.title} body={dict.insight.body} tone="dark" />
      <EditorialSection label={dict.category.label} title={dict.category.title} body={dict.category.body} tone="light" />
      <HowItWorks dict={dict} />
      <Intelligence dict={dict} />
      <Capabilities dict={dict} />
      <HumanAI dict={dict} />
      <Industries dict={dict} locale={locale} />
      <Trust dict={dict} />
      <FAQ dict={dict} />
      <FinalCTA dict={dict} locale={locale} />
    </>
  );
}

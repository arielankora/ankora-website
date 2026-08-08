import type { Metadata } from "next";
import "@fontsource/heebo/300.css";
import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/600.css";
import "@fontsource/heebo/700.css";
import "@fontsource/heebo/800.css";
import "../globals.css";
import { getDictionary, locales, type Locale } from "@/content";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const dict = getDictionary(params.locale);
  return {
    title: dict.meta.title,
    description: dict.meta.description,
    alternates: {
      languages: { he: "/he", en: "/en" },
    },
    openGraph: {
      title: dict.meta.title,
      description: dict.meta.description,
      type: "website",
    },
  };
}

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const dir = locale === "he" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body className="font-sans antialiased">
        <Header dict={dict} locale={locale} />
        <main>{children}</main>
        <Footer dict={dict} locale={locale} />
      </body>
    </html>
  );
}

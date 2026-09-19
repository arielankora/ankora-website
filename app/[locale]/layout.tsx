import type { Metadata } from "next";
import "@fontsource/heebo/200.css";
import "@fontsource/heebo/300.css";
import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/600.css";
import "@fontsource/heebo/700.css";
import "@fontsource/heebo/800.css";
// Redesign (/he) typography: Assistant for body/lead/eyebrow, JetBrains Mono for captions.
import "@fontsource/assistant/200.css";
import "@fontsource/assistant/300.css";
import "@fontsource/assistant/400.css";
import "@fontsource/assistant/500.css";
import "@fontsource/assistant/600.css";
import "@fontsource/jetbrains-mono/300.css";
import "@fontsource/jetbrains-mono/400.css";
import "../globals.css";
import { getDictionary, locales, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { PageShell } from "@/components/layout/PageShell";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const dict = getDictionary(params.locale);
  return {
    metadataBase: new URL(SITE_URL),
    title: dict.meta.title,
    description: dict.meta.description,
    alternates: {
      canonical: `/${locale}`,
      languages: { he: "/he", en: "/en" },
    },
    openGraph: {
      title: dict.meta.title,
      description: dict.meta.description,
      type: "website",
      locale: locale === "he" ? "he_IL" : "en_US",
    },
  };
}

export default async function LocaleLayout(
  props: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const dir = locale === "he" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <head>
        {/* Google tag (gtag.js) */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-XZ1T8Z0NDY"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());

              gtag('config', 'G-XZ1T8Z0NDY');
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <PageShell locale={locale}>
          <Header dict={dict} locale={locale} />
          <main>{children}</main>
          <Footer dict={dict} locale={locale} />
        </PageShell>
      </body>
    </html>
  );
}

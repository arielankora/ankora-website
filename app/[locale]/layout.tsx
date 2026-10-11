import type { Metadata } from "next";
import { notFound } from "next/navigation";
// Brand fonts (Heebo, Assistant, JetBrains Mono) as self-hosted variable fonts.
import "../fonts.css";
import "../globals.css";
import { getDictionary, locales, type Locale } from "@/content";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { PageShell } from "@/components/layout/PageShell";
import { CtaTracking } from "@/components/analytics/CtaTracking";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteGraph } from "@/lib/schema";
import { getBlogTranslationPairs } from "@/lib/blog";
import { ogBase } from "@/lib/seo-meta";

function isLocale(value: string): value is Locale {
  return (locales as string[]).includes(value);
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata(
  props: {
    params: Promise<{ locale: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  if (!isLocale(params.locale)) notFound();
  const locale = params.locale;
  const dict = getDictionary(params.locale);
  return {
    metadataBase: new URL(SITE_URL),
    // The marketing site had no icon at all: browsers and Google fell back to
    // a generic globe, and /favicon.ico was swallowed by the [locale] route.
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/site-icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/site-icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/site-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    title: dict.meta.title,
    description: dict.meta.description,
    alternates: {
      canonical: `/${locale}`,
      languages: { he: "/he", en: "/en", "x-default": "/he" },
    },
    openGraph: {
      title: dict.meta.title,
      description: dict.meta.description,
      type: "website",
      ...ogBase(locale, ""),
    },
    twitter: { card: "summary_large_image" },
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

  // Any single path segment lands in this layout as a "locale". Before this
  // check, /favicon.ico, /llms.txt and /anything rendered the Hebrew home page
  // with a 200 (soft 404s in Search Console).
  if (!isLocale(params.locale)) notFound();
  const locale: Locale = params.locale;
  const dict = getDictionary(locale);
  const dir = locale === "he" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <head>
        {/* The headline face, fetched with the HTML instead of after the CSS. */}
        <link
          rel="preload"
          href={locale === "he" ? "/fonts/heebo-hebrew-var-v5.woff2" : "/fonts/heebo-latin-var-v5.woff2"}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Google tag (gtag.js). Not loaded for automated browsers: about 97% of
            GA4 users in the 90 days to 1.10.2026 were headless Chrome in US data
            centres (0s engagement), which made every report unusable.
            navigator.webdriver is set by Playwright, Puppeteer and Selenium. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              if (!navigator.webdriver) {
                var s = document.createElement('script');
                s.async = true;
                s.src = 'https://www.googletagmanager.com/gtag/js?id=G-XZ1T8Z0NDY';
                document.head.appendChild(s);
                gtag('js', new Date());
                gtag('config', 'G-XZ1T8Z0NDY');
              }
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <PageShell>
          <Header dict={dict} locale={locale} blogPairs={getBlogTranslationPairs()} />
          <main>{children}</main>
          <Footer dict={dict} locale={locale} />
        </PageShell>
        <CtaTracking />
        {/* Ankora as one entity, on every page (lib/schema.ts). */}
        <JsonLd id="site-graph" data={siteGraph(locale)} />
      </body>
    </html>
  );
}

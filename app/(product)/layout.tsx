import type { Metadata, Viewport } from "next";
import "@fontsource/heebo/300.css";
import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/600.css";
import "@fontsource/heebo/700.css";
import "../globals.css";
import { ToastProvider } from "@/components/app/toast/ToastProvider";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { pickMessages } from "@/lib/i18n/client-messages";
import { resolveRequestLocale } from "@/lib/i18n/resolve";
import { directionOf, intlTag } from "@/lib/i18n/config";

// Second Next.js "root layout" - see ADR-0001 and the note in
// app/[locale]/layout.tsx's sibling: this route group lives outside
// [locale] (it's an internal tool, not a marketing page - spec section 2.2
// explicitly defers full i18n), so it needs its own <html>/<body>, per
// Next.js's documented "multiple root layouts" pattern. Same fonts/tokens
// as the marketing site (ADR-0001 section 3) - no new brand.
//
// Phase 7 (ADR addendum 14.2, fixed per 14.2 addendum below): the
// manifest is a static file at public/manifest.webmanifest, referenced
// explicitly here via `manifest:` - Next.js's file-convention manifest.ts
// route conflicted with app/[locale]'s catch-all locale segment (a
// request to /manifest.webmanifest at the site root was being swallowed
// by [locale] and served the marketing homepage's HTML instead of the
// manifest JSON, found during this phase's own live QA). A static public
// file bypasses app-router path matching entirely, so no such conflict is
// possible. Scoped to this route group only via this layout's own
// metadata - the marketing site under app/[locale] has no manifest link.
const baseMetadata: Metadata = {
  robots: { index: false, follow: false }, // internal tool, never indexed
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ankora",
  },
};

// ADR 0006: the tab title is in the person's language, so the metadata is
// generated per request instead of being a constant.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell");
  return { ...baseMetadata, title: t("documentTitle") };
}

export const viewport: Viewport = {
  themeColor: "#1B2A3D",
  width: "device-width",
  initialScale: 1,
  // statusBarStyle "black-translucent" draws the page under the iPhone
  // status bar once the app is added to the home screen. Without
  // viewport-fit=cover, env(safe-area-inset-*) stays 0 and the logo sat
  // under the clock (mobile check, 20.10.2026, iPhone 15 Pro Max). With it,
  // each shell pads its own top edge and the bottom nav its bottom edge.
  viewportFit: "cover",
};

// App redesign (design_handoff_ankora_app_redesign/README.md, "State
// Management"): "תור טוסטים הוא הרכיב הגלובלי היחיד שצריך להוסיף... מומלץ
// להציב אותו ב-app/(product)/layout.tsx" - mounted here, above every route
// under this group (the internal app *and* the login/forgot/reset-password
// pages that sit outside (authenticated)), so useToast() works anywhere in
// app/(product)/app/**.
//
// ADR 0006: the language and direction are the signed-in person's own
// (i18n/request.ts), Hebrew for everyone else. The provider hands the same
// locale, time zone and dictionary to the client components below it, so
// a client component and the server agree on every word and every date.
export default async function ProductRootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await resolveRequestLocale();
  // Only the namespaces a component in the browser reads; see
  // lib/i18n/client-messages.ts for why not the whole dictionary.
  const messages = pickMessages(await getMessages());
  return (
    <html lang={intlTag(locale)} dir={directionOf(locale)}>
      <body className="bg-app-surface-page text-app-text-primary antialiased">
        <NextIntlClientProvider messages={messages}>
          <ToastProvider>{children}</ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

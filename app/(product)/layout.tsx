import type { Metadata, Viewport } from "next";
import "@fontsource/heebo/300.css";
import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/600.css";
import "@fontsource/heebo/700.css";
import "../globals.css";

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
export const metadata: Metadata = {
  title: "Ankora - ניהול שעות",
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

export const viewport: Viewport = {
  themeColor: "#1B2A3D",
  width: "device-width",
  initialScale: 1,
};

export default function ProductRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="bg-paper text-navy antialiased">{children}</body>
    </html>
  );
}

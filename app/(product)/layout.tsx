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
// Phase 7 (ADR addendum 14.2): manifest.ts lives alongside this layout so
// Next.js's metadata inheritance only links it into pages under this
// route group (the product tool) - the marketing site under app/[locale]
// intentionally has no manifest of its own. icons/appleWebApp here cover
// the installability meta tags a manifest link alone doesn't add.
export const metadata: Metadata = {
  title: "Ankora - ניהול שעות",
  robots: { index: false, follow: false }, // internal tool, never indexed
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

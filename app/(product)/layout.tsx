import type { Metadata } from "next";
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
export const metadata: Metadata = {
  title: "Ankora - ניהול שעות",
  robots: { index: false, follow: false }, // internal tool, never indexed
};

export default function ProductRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="bg-paper text-navy antialiased">{children}</body>
    </html>
  );
}

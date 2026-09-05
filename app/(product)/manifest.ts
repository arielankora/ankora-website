import type { MetadataRoute } from "next";

// Spec section 2.2's PWA note: "PWA רספונסיבית היא ברירת המחדל ל-MVP...
// יש להוסיף manifest, icons ו-installability, אך לא להפוך PWA לתלות
// קשיחה." This file only covers the internal product tool under
// app/(product)/app/** (its own root layout - see that layout's own
// comment on Next.js's "multiple root layouts" pattern) - the marketing
// site under app/[locale]/** is a separate root layout and intentionally
// gets no manifest of its own; installing the marketing site as an "app"
// isn't a real use case, only the operational tool is. No service worker,
// no offline caching, no push - see ADR addendum section 14.2/14.6.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ankora - ניהול שעות ובנקי שעות",
    short_name: "Ankora",
    description: "ניהול שעות, משימות ובנקי שעות עבור צוות ולקוחות Ankora.",
    start_url: "/app",
    scope: "/app",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#1B2A3D",
    theme_color: "#1B2A3D",
    dir: "rtl",
    lang: "he",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

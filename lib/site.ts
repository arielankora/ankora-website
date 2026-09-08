// Single source of truth for Ankora's canonical host. Every canonical tag,
// hreflang alternate, JSON-LD absolute URL, sitemap <loc>, and robots.txt
// sitemap pointer must resolve through this constant so the site never again
// drifts into declaring a different host than the one it actually serves
// from (docs/adr/0002).
export const SITE_URL = "https://www.ankora.co.il";

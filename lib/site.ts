// Single source of truth for Ankora's canonical host. Every canonical tag,
// hreflang alternate, JSON-LD absolute URL, sitemap <loc>, and robots.txt
// sitemap pointer must resolve through this constant so the site never again
// drifts into declaring a different host than the one it actually serves
// from (docs/adr/0002).
export const SITE_URL = "https://www.ankora.co.il";

/// Hosts that resolve, serve Ankora, and still cannot be opened by the
/// person we sent the link to.
///
/// Vercel's deployment protection on this project runs in
/// `all_except_custom_domains` mode, so every *.vercel.app address -
/// including the production deployment's own immutable one - answers with
/// a Vercel sign-in wall. A recipient clicking such a link never reaches
/// Ankora at all. That is not a broken page they can report; it is a
/// different company's login screen.
///
/// Used in two places that must agree: the origin we build outbound links
/// from (lib/email-templates.ts), and the last check before an email
/// leaves the building (lib/email.ts).
export function isUnreachableFromOutside(hostname: string): boolean {
  return /(^|\.)vercel\.app$/i.test(hostname);
}

/// Every absolute link in a blob of text or HTML whose host the recipient
/// cannot open. Returns them in order, so an error message can name one.
export function unreachableLinksIn(content: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)) {
    try {
      if (isUnreachableFromOutside(new URL(match[0]).hostname)) found.push(match[0]);
    } catch {
      // Not a URL we can parse is not a URL we can judge.
    }
  }
  return found;
}

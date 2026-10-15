// /.well-known/security.txt (RFC 9116): where a researcher who found a
// vulnerability in ankora.co.il reports it.
//
// Served from a route handler mapped by a rewrite in next.config.mjs, the
// same pattern the OAuth discovery documents use, rather than a dot-prefixed
// folder under public/ or app/.
//
// EXPIRES IS A CHORE, ON PURPOSE. RFC 9116 makes Expires mandatory and asks
// for less than a year, so that a security.txt nobody maintains stops being
// trusted. tests/unit/security-txt.test.ts fails once fewer than 30 days are
// left, which turns "remember to renew" into a red build a month ahead.
// Renewing means moving this date six months forward, after checking that
// the Contact address is still read by a person.

export const SECURITY_TXT_EXPIRES = "2027-04-15T00:00:00.000Z";
export const SECURITY_CONTACT = "security@ankora.co.il";

const ORIGIN = "https://www.ankora.co.il";

export function securityTxt(): string {
  return [
    `Contact: mailto:${SECURITY_CONTACT}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    `Preferred-Languages: he, en`,
    `Canonical: ${ORIGIN}/.well-known/security.txt`,
    `Policy: ${ORIGIN}/en/security`,
    ``,
  ].join("\n");
}

import fs from "node:fs";
import path from "node:path";
import { getAllStories } from "@/lib/customer-stories";
import { MCP_TOKEN_PREFIX } from "@/lib/mcp/token";
import { FILE_TICKET_PREFIX } from "@/lib/mcp/file-ticket";

// The list of pages to sweep is derived from qa/manifest.json, not typed
// out here.
//
// This is the same principle the rest of the suite runs on: a
// hand-written list of routes is a second inventory, and it goes stale
// the first time someone adds a page. Reading the manifest means the day
// a new marketing page or product screen lands, the sweep already covers
// it - and if nobody has run `npm run qa:sync`, the drift check says so
// loudly on the same run.

type Manifest = { capabilities: Record<string, { kind: string; area: string }> };

const manifest: Manifest = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "qa", "manifest.json"), "utf8"),
);

const ids = Object.entries(manifest.capabilities);

/** Public marketing pages, expanded across both locales. */
export const MARKETING_ROUTES: string[] = ids
  .filter(([id, c]) => c.kind === "page" && c.area === "marketing")
  .map(([id]) => id.slice("page:".length))
  // `[locale]` is not a dynamic segment in the sense that matters here - it
  // is expanded to he and en below. Every OTHER bracket is: /blog/[slug]
  // needs a real slug, so it belongs in a test that creates or names one.
  //
  // The original tested the raw id for a bracket, before stripping
  // `[locale]`. Every marketing page id contains `[locale]`, so the filter
  // matched all 26 of them and MARKETING_ROUTES came out EMPTY. The sweep
  // ran, collected zero pages, and passed - which is the exact failure this
  // suite exists to catch, committed by the suite itself. The scanner had
  // been reporting it honestly as 20 uncovered pages the whole time; I read
  // the critical rows and skipped the medium ones.
  .filter((route) => !route.replace("/[locale]", "").includes("["))
  .flatMap((route) => ["he", "en"].map((locale) => route.replace("/[locale]", `/${locale}`)))
  .sort();

/**
 * The unauthenticated entry points, which have their own spec
 * (qa/e2e/auth-screens.spec.ts, qa/e2e/login-link.spec.ts). Anything
 * listed here is deliberately reachable without a session, so the
 * signed-in sweep below skips it.
 */
export const AUTH_SCREENS = [
  "/app/login",
  "/app/forgot-password",
  "/app/reset-password",
  // Portal phase 0.
  "/app/login-link",
  "/app/login-link/request",
];

/**
 * Product screens behind the session. Dynamic segments are excluded: a
 * route like /app/clients/[clientId] needs a real id, so it belongs in a
 * flow test that creates one rather than in a blind sweep.
 */
export const APP_SCREENS: string[] = ids
  .filter(([id, c]) => c.kind === "screen" && !id.includes("["))
  .map(([id]) => id.slice("screen:".length))
  // Derived from AUTH_SCREENS rather than repeating the list: the two
  // portal sign-in-link screens were added to the manifest and not here,
  // so the signed-in sweep tried to open them and failed on a screen that
  // is public by design. The next public screen added should not be able
  // to repeat that.
  .filter((route) => !AUTH_SCREENS.includes(route))
  .sort();

/**
 * Story pages, which the manifest-derived sweep above cannot reach.
 *
 * MARKETING_ROUTES excludes any route with a dynamic segment, because
 * /customer-stories/[slug] needs a real slug. The corpus is small and every
 * published story is a page a stranger can land on from search, so they are
 * listed from the same data the site renders from rather than typed out here -
 * a story added next month is swept next month, and a story set to `draft`
 * leaves the sweep on the same edit that removes it from the site.
 */
export const CUSTOMER_STORY_ROUTES: string[] = ["he", "en"].flatMap((locale) =>
  getAllStories(locale as "he" | "en").map((story) => `/${locale}/customer-stories/${story.slug}`),
);



/**
 * Console noise that is not a product fault.
 *
 * Kept deliberately short. Every entry here is a hole in the check, so
 * the bar is "this cannot be caused by our code" - not "this is annoying
 * and I want the test to pass".
 */
const IGNORED_CONSOLE = [
  /favicon\.ico/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
];

export function isRealConsoleError(text: string): boolean {
  return !IGNORED_CONSOLE.some((re) => re.test(text));
}

/**
 * Credential material that must never appear in a served document.
 *
 * Lives here rather than in one spec because the same sweep runs under
 * more than one session: a screen can be empty for an employee and full
 * of rows for a Super Admin, and the leak is in the rows.
 *
 * The bcrypt pattern matches the format, not a known value, so it also
 * catches a hash belonging to a user seeded after this was written.
 */
export const CREDENTIAL_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /\$2[aby]\$\d\d\$/, what: "a bcrypt hash" },
  { pattern: /passwordHash/, what: "a passwordHash field" },
  { pattern: /tokenHash/, what: "a token hash field" },

  // Added 2026-10-15, during the monthly security review.
  //
  // The three patterns above were written in September, when the only
  // credential material in the database was a password hash. Since then
  // the product grew two stores of far more sensitive material, and this
  // sweep covered neither: a leak of either one would have passed.
  //
  // The structural mistake is unchanged - a database row handed whole to
  // a client component is serialised into the RSC payload inside the page
  // HTML - so the same sweep catches it, once it knows what to look for.

  // The access vault. A Credential row keeps its username, password and
  // notes in `secretCiphertext` under a per-row data key (`wrappedDek`).
  // The encryption is sound, which is exactly why the field names are the
  // right thing to match on: shipping the ciphertext, the IV, the tag and
  // the wrapped key to the browser hands over everything except the master
  // key, and it would look like harmless binary on screen.
  { pattern: /secretCiphertext|secretIv|secretTag|wrappedDek/, what: "an encrypted vault column" },

  // Added 20.10.2026, during the weekly level-3 hunt.
  //
  // Found by comparing this list against prisma/schema.prisma rather than
  // against memory: four credential columns were not covered by anything
  // above. `/tokenHash/` is case-sensitive, and the columns are spelled
  // accessTokenHash and refreshTokenHash with a capital T, so the pattern
  // that looks like it covers them does not.
  //
  // No leak was found today - lib/app-domain/mcp-connections.ts selects
  // its columns explicitly and reaches for none of these. That is the
  // point: the sweep is what would say so if that ever changed, and for
  // these four it would have stayed quiet.
  //
  // tests/unit/credential-sweep-schema.test.ts now derives the expected
  // coverage from the schema, so the next credential column to be added
  // fails that test until someone decides about it. A list maintained by
  // remembering is a list that lags, and this one lagged for five weeks.
  {
    pattern: /accessTokenHash|refreshTokenHash|clientSecretHash|codeHash/,
    what: "an OAuth or MCP credential hash column",
  },

  // MCP bearer capabilities. Both prefixes exist so that secret scanners
  // can match them (see lib/mcp/file-ticket.ts) - this is that scanner.
  // Imported rather than typed out, so a change to either prefix cannot
  // silently blind the test. The length floor means prose that merely
  // mentions a prefix does not trip it; only a real token value does.
  {
    pattern: new RegExp(`\\b(?:${MCP_TOKEN_PREFIX}|${FILE_TICKET_PREFIX})[A-Za-z0-9_-]{20,}`),
    what: "an MCP token or file ticket",
  },

  // Shapes that are never legitimate in a served document, whatever the
  // screen. Narrow on purpose: see the note below.
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: "a private key" },
  {
    pattern: /\b(sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/,
    what: "an API key",
  },
];

// Why this list is deliberately narrower than lib/secret-scan.ts.
//
// That module scans text a person typed, and asks "did someone paste a
// secret into a note". It can afford fuzzy patterns - a password written
// as "the password is hunter2", a card number, a JWT - because a false
// positive there is a warning on one field.
//
// This list scans every served document on every app screen, and a false
// positive here fails the build. Patterns that read natural language do
// not survive that: a login form legitimately contains the word password,
// an hours report legitimately contains long runs of digits, and `sk-`
// appears inside ordinary kebab-case markup like "task-supervisor" unless
// the word boundary is right. A sweep that cries wolf gets switched off,
// and then it protects nothing.
//
// So the rule for adding to this list: match a shape that cannot occur by
// accident in HTML, or a database column name that no UI should ever
// render. Fuzzier detection belongs in secret-scan.ts.

/**
 * Product screens whose route carries a dynamic segment.
 *
 * APP_SCREENS above drops every one of these, with a reason that is
 * sound on its own terms: a blind sweep cannot invent an id. What the
 * reason does not say is that the credential sweep built in #84 - the
 * one structural guard against a database row being serialised into a
 * page's HTML - therefore runs on 41 screens and skips 11.
 *
 * That is the wrong 11. A list screen renders names and counts; a
 * detail screen renders a record, and a record is where the columns
 * are. Two of the three leaks that sweep exists for were on screens in
 * this list: /app/users/[userId] handed over a whole User row, and
 * /app/important-dates/[id] handed over the whole user list. Only the
 * first of those two is checked today, by a hand-written test in
 * credentials.super.spec.ts, and a hand-written test covers the screen
 * somebody remembered.
 *
 * Derived from the manifest for the same reason the list above is: the
 * five newest screens here all landed in the last five weeks, and not
 * one of them was added to any sweep.
 */
export const DYNAMIC_SCREENS: string[] = ids
  .filter(([id, c]) => c.kind === "screen" && id.includes("["))
  .map(([id]) => id.slice("screen:".length))
  .sort();

/**
 * The dynamic screens the browser sweep reaches, and how it gets there.
 *
 * No id is typed out. Each route is resolved from a page the product
 * itself rendered: the list screen above it, or - for a screen two
 * levels down - a link harvested from a screen already resolved. An id
 * written into a spec is a fixture dependency in disguise.
 *
 * `optional` means the sweep cannot insist on finding an instance,
 * because whether one exists depends on what the database holds rather
 * than on the product being correct. Those print a line naming what was
 * not swept; everything else is a failure, because a screen that
 * silently resolves to nothing is a check that silently stopped.
 */
export const DYNAMIC_SWEEP: { route: string; optional?: string }[] = [
  { route: "/app/clients/[clientId]" },
  { route: "/app/clients/[clientId]/client-file" },
  { route: "/app/clients/[clientId]/handover" },
  { route: "/app/clients/[clientId]/procedures" },
  {
    route: "/app/clients/[clientId]/processes/[processId]/document",
    optional: "needs a process with an approved version on the first client; the approval flow creates one, and spec order is not guaranteed",
  },
  { route: "/app/categories/[categoryId]" },
  { route: "/app/tasks/[id]" },
  { route: "/app/users/[userId]" },
  {
    route: "/app/important-dates/[id]",
    optional: "the demo seed creates no important dates; inventing one here would make this a creation test wearing a sweep's name",
  },
];

/**
 * Dynamic screens the sweep deliberately leaves alone, each with the
 * reason. Not a backlog: anything not listed here has to be swept.
 */
export const DYNAMIC_NOT_SWEPT: Record<string, string> = {
  "/agreements/sign/[token]":
    "public, reached only with a signing token the product mails out. flows-agreements.super.spec.ts opens it with a real token and is the right place for it.",
  "/agreements/upload/[token]":
    "same token, same spec. Neither screen is behind the session this sweep signs in with.",
};

/** `/app/clients/[clientId]/procedures` as a matcher for a real address. */
export function routePattern(route: string): RegExp {
  return new RegExp(`^${route.replace(/[.*+?^${}()|\\]/g, "\\$&").replace(/\[[^\]]+\]/g, "[^/]+")}$`);
}

/** The part of a route before its first dynamic segment: its list screen. */
export function parentListRoute(route: string): string {
  return route.slice(0, route.indexOf("/["));
}

/**
 * `route` with the ids of a screen already resolved above it.
 *
 * `/app/clients/[clientId]/handover` is the client whose screen was just
 * swept, not a second lookup: the suffix comes from the manifest route
 * itself, so the address is the product's own rather than a guess. A
 * segment nothing has resolved yet is left in brackets, which is how the
 * caller knows it still has to find one.
 */
export function substituteKnownIds(route: string, resolved: Map<string, string>): string {
  const seg = route.split("/");
  const out = [...seg];
  for (const [pattern, url] of resolved) {
    const ps = pattern.split("/");
    if (ps.length > seg.length) continue;
    const prefixes = ps.every((s, i) => s === seg[i] || (s.startsWith("[") && (seg[i] ?? "").startsWith("[")));
    if (!prefixes) continue;
    const us = url.split("/");
    for (let i = 0; i < ps.length; i += 1) if (seg[i].startsWith("[")) out[i] = us[i];
  }
  return out.join("/");
}

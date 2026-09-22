// Live production probe.
//
// Everything else in this suite proves the code is correct. This proves
// the thing users actually reach is up, wearing the security headers it
// is supposed to wear, and serving the pages it is supposed to serve.
// The two are not the same claim: a green build with a broken redirect,
// a dropped CSP header or an expired certificate is still a green build.
//
// Note on where this runs: ankora.co.il is blocked by egress policy from
// the Claude sandbox and from the device bridge, so a local invocation
// will skip this check by design. It runs for real in GitHub Actions,
// which has no such restriction - that is the intended home for it.

import { finding } from "../lib/report.mjs";
import { fetchOnce, unreachableBecause } from "../lib/sh.mjs";

// The canonical host, per lib/site.ts and docs/adr/0002. Probing the apex
// instead returns 308 on every single route - which the first CI run duly
// reported as ten production outages. The apex redirect is itself worth
// guarding, so it gets its own assertion below rather than being papered
// over with `redirect: "follow"`.
const BASE = process.env.QA_PROD_URL ?? "https://www.ankora.co.il";
const APEX = "https://ankora.co.il";

// The host the invite incident collided with.
//
// Vercel's deployment protection on this project runs in
// `all_except_custom_domains` mode: every *.vercel.app address answers
// with a Vercel sign-in wall, and only the custom domains are public.
// The whole reason a valid invite was unopenable is that it named one of
// these. That protection is now load-bearing in two directions at once -
// it is part of the security posture, AND it is the condition that makes
// a stray vercel.app link fail loudly instead of quietly working.
//
// So it is worth an assertion. If someone switches it off, the guards in
// lib/email.ts and lib/email-templates.ts keep doing their job, but the
// evidence that they matter disappears, and a stray link would look fine
// to everyone who tried it.
const PROTECTED_ALIAS = process.env.QA_PROTECTED_ALIAS ?? "https://ankora-website.vercel.app";

/** Headers every response must carry, and what each one is actually for. */
const REQUIRED_HEADERS = {
  "strict-transport-security": "HTTPS downgrade protection",
  "content-security-policy": "script-injection containment",
  "x-frame-options": "clickjacking protection",
  "x-content-type-options": "MIME-sniffing protection",
  "referrer-policy": "referrer leakage",
  "permissions-policy": "device API access",
};

const FORBIDDEN_HEADERS = {
  "x-powered-by": "framework fingerprinting",
};

/** Routes whose failure a user would notice within a minute. */
const ROUTES = [
  { path: "/", expect: [200, 307, 308] },
  { path: "/he", expect: [200] },
  { path: "/en", expect: [200] },
  { path: "/he/pricing", expect: [200] },
  { path: "/he/contact", expect: [200] },
  { path: "/he/blog", expect: [200] },
  { path: "/app/login", expect: [200] },
  { path: "/api/health", expect: [200], json: true },
  { path: "/sitemap.xml", expect: [200] },
  { path: "/robots.txt", expect: [200] },
  // The product must not be reachable without a session, and must not be
  // indexable. Both have been regressions in this codebase before.
  { path: "/app/timer", expect: [200, 302, 307], mustRedirectToLogin: true },
];

/**
 * Distinguish "the site is down" from "this machine is not allowed to
 * talk to it".
 *
 * Learned the hard way while building this: an egress proxy answers every
 * request with a bare 403, which the first version of this check happily
 * reported as eleven production outages. The tell is the headers - a 403
 * that genuinely came from Ankora still passes through the middleware
 * that stamps HSTS and CSP onto every response. A 403 with none of those
 * headers never reached Ankora at all.
 */
export async function egressBlocked() {
  const { res } = await fetchOnce(`${BASE}/api/health`, { timeoutMs: 10_000, retries: 0 });
  if (!res) return false; // a transport error is real unreachability, handled below
  if (res.status !== 403 && res.status !== 407) return false;
  const ours = ["strict-transport-security", "content-security-policy", "x-frame-options"].some((h) =>
    res.headers.get(h),
  );
  return !ours;
}

export const skipIfUnreachable = async () => {
  if (await egressBlocked()) return `${BASE} blocked by this network's egress policy — the probe belongs in CI`;
  // Name the cause. "not reachable" on its own cannot be acted on, and on a CI
  // runner it is the difference between "the site is down" and "DNS hiccuped".
  const why = await unreachableBecause(BASE);
  if (why) return `${BASE} not reachable from here (${why})`;
  return null;
};

export async function probe() {
  const out = [];

  for (const route of ROUTES) {
    const url = `${BASE}${route.path}`;
    const { res, error } = await fetchOnce(url);
    if (!res) {
      out.push(finding("blocker", `${route.path} unreachable`, error));
      continue;
    }

    if (!route.expect.includes(res.status)) {
      out.push(finding("blocker", `${route.path} returned ${res.status}`, `expected ${route.expect.join(" or ")}`));
      continue;
    }

    if (route.mustRedirectToLogin && res.status === 200) {
      out.push(finding("blocker", `${route.path} served 200 without a session`, "authenticated route is publicly reachable"));
    }

    if (route.json) {
      try {
        await res.clone().json();
      } catch {
        out.push(finding("major", `${route.path} did not return JSON`, await res.clone().text().catch(() => "")));
      }
    }

    // Header policy is only meaningful on real HTML responses.
    if (res.status === 200 && (res.headers.get("content-type") ?? "").includes("text/html")) {
      for (const [h, why] of Object.entries(REQUIRED_HEADERS)) {
        if (!res.headers.get(h)) out.push(finding("major", `${route.path} missing ${h}`, why));
      }
      for (const [h, why] of Object.entries(FORBIDDEN_HEADERS)) {
        if (res.headers.get(h)) out.push(finding("minor", `${route.path} exposes ${h}`, why));
      }
      if (route.path.startsWith("/app")) {
        const csp = res.headers.get("content-security-policy") ?? "";
        // The product deliberately carries zero third-party script origins
        // (PR #43). A third-party origin creeping back in is a silent
        // widening of the CSP bypass surface.
        if (/googletagmanager|google-analytics|googletagservices/.test(csp)) {
          out.push(finding("major", `${route.path} CSP regained a third-party script origin`, csp.slice(0, 300)));
        }
        if (!(res.headers.get("x-robots-tag") ?? "").includes("noindex")) {
          const html = await res.clone().text();
          if (!/noindex/.test(html)) out.push(finding("minor", `${route.path} is indexable`, "expected noindex on the product"));
        }
      }
    }
  }

  // ADR-0002: the apex must 308 to www and preserve the path. Google reads
  // a broken version of this as a self-contradicting canonical signal, and
  // the last time it drifted it cost 16 URLs in Search Console.
  //
  // The apex is a SEPARATE hostname from the canonical one, so it can fail to
  // resolve on a runner while www answers every route fine - which is exactly
  // what happened once, reported as an unactionable "fetch failed". A
  // transport failure here is therefore reported with its cause and as a
  // minor: it says nothing about whether the apex redirect is correct, only
  // that this machine could not ask. A wrong ANSWER is still major.
  const apex = await fetchOnce(`${APEX}/he/pricing`);
  if (!apex.res) {
    out.push(
      finding(
        "minor",
        "apex redirect could not be checked from this runner",
        `${apex.error} — ${APEX} did not answer, while ${BASE} served every route above. That is a property of this machine's DNS/network, not evidence about the redirect.`,
      ),
    );
  } else {
    const to = apex.res.headers.get("location") ?? "";
    if (apex.res.status !== 308) {
      out.push(finding("major", `apex returned ${apex.res.status}, expected a 308 to www`, "ADR-0002"));
    } else if (!to.startsWith(`${BASE}/he/pricing`)) {
      out.push(finding("major", "apex redirect dropped the path", `Location: ${to}`));
    }
  }

  // Deployment protection, per the note on PROTECTED_ALIAS above.
  //
  // The tell is the same one egressBlocked() uses: Ankora stamps HSTS and
  // CSP onto every response it serves. A wall put up by Vercel in front of
  // the deployment carries neither, because the request never reached us.
  // So "200 wearing our headers" is the one answer that means the door is
  // open, and anything else - a 401, a redirect to Vercel, a bare 403 from
  // some proxy in between - means it is not.
  const guarded = await fetchOnce(`${PROTECTED_ALIAS}/app/login`);
  if (!guarded.res) {
    out.push(
      finding(
        "minor",
        "deployment protection could not be checked from this runner",
        `${guarded.error} — ${PROTECTED_ALIAS} did not answer. That says nothing about whether the protection is on, only that this machine could not ask.`,
      ),
    );
  } else {
    const wearingOurHeaders = ["strict-transport-security", "content-security-policy"].every((h) =>
      guarded.res.headers.get(h),
    );
    if (guarded.res.status === 200 && wearingOurHeaders) {
      out.push(
        finding(
          "major",
          `${PROTECTED_ALIAS} serves the product with no sign-in wall`,
          [
            "Vercel deployment protection appears to be off for *.vercel.app hosts.",
            "Two consequences: the product answers on a second, non-canonical origin, and a",
            "stray vercel.app link in an outgoing email would silently work for whoever tried",
            "it while still being the wrong address. See the 22.9.2026 invite incident.",
            "Expected: Vercel's own sign-in wall, i.e. a response not wearing Ankora's headers.",
          ].join("\n"),
        ),
      );
    }
  }

  out.push(finding("info", `probed ${ROUTES.length} routes on ${BASE}`));
  return out;
}

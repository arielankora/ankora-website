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
import { reachable } from "../lib/sh.mjs";

// The canonical host, per lib/site.ts and docs/adr/0002. Probing the apex
// instead returns 308 on every single route - which the first CI run duly
// reported as ten production outages. The apex redirect is itself worth
// guarding, so it gets its own assertion below rather than being papered
// over with `redirect: "follow"`.
const BASE = process.env.QA_PROD_URL ?? "https://www.ankora.co.il";
const APEX = "https://ankora.co.il";

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
  try {
    const res = await fetch(`${BASE}/api/health`, { redirect: "manual", headers: { "user-agent": "ankora-qa/1" } });
    if (res.status !== 403 && res.status !== 407) return false;
    const ours = ["strict-transport-security", "content-security-policy", "x-frame-options"].some((h) =>
      res.headers.get(h),
    );
    return !ours;
  } catch {
    return false; // a transport error is a real unreachability, handled below
  }
}

export const skipIfUnreachable = async () => {
  if (await egressBlocked()) return `${BASE} blocked by this network's egress policy — the probe belongs in CI`;
  if (!(await reachable(BASE))) return `${BASE} not reachable from here`;
  return null;
};

export async function probe() {
  const out = [];

  for (const route of ROUTES) {
    const url = `${BASE}${route.path}`;
    let res;
    try {
      res = await fetch(url, { redirect: "manual", headers: { "user-agent": "ankora-qa/1" } });
    } catch (err) {
      out.push(finding("blocker", `${route.path} unreachable`, String(err?.message ?? err)));
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
  try {
    const res = await fetch(`${APEX}/he/pricing`, { redirect: "manual" });
    const to = res.headers.get("location") ?? "";
    if (res.status !== 308) {
      out.push(finding("major", `apex returned ${res.status}, expected a 308 to www`, `ADR-0002`));
    } else if (!to.startsWith(`${BASE}/he/pricing`)) {
      out.push(finding("major", "apex redirect dropped the path", `Location: ${to}`));
    }
  } catch (err) {
    out.push(finding("major", "apex redirect could not be checked", String(err?.message ?? err)));
  }

  out.push(finding("info", `probed ${ROUTES.length} routes on ${BASE}`));
  return out;
}

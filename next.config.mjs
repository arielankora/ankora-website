// Vercel origins the Content-Security-Policy below allows on preview and
// local builds only - never on production. See the CSP comment for why
// each one is needed. Empty string on production so the directives it is
// interpolated into come out byte-identical to the strict policy.
const PREVIEW_ORIGINS =
  process.env.VERCEL_ENV === 'production' ? '' : ' https://vercel.com https://vercel.live';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Security review (information disclosure). Next.js sends
  // `X-Powered-By: Next.js` on every response by default, handing a
  // scanner the framework to look up advisories for before it has probed
  // anything. Removing it is not a defense in itself, but there is no
  // reason to volunteer the information.
  poweredByHeader: false,

  images: {
    // Security review (GHSA-2xp9-vwfh-vxw4, CVSS critical): Next.js
    // versions before 15.5.24 have an unauthenticated remote-code-
    // execution flaw in the Image Optimization API that is reached
    // specifically through AVIF handling. There is no patch on the 14.x
    // line - the real fix is the major upgrade tracked separately in the
    // security review PR description.
    //
    // Two things limit the exposure here in the meantime: `remotePatterns`
    // is not configured, so only images already in this repository can be
    // optimized, and Vercel serves image optimization from its own
    // infrastructure rather than this bundle. Dropping AVIF removes the
    // affected code path from the negotiation regardless, at the cost of
    // slightly larger images for browsers that prefer AVIF over WebP -
    // a trade worth making until the upgrade lands.
    //
    // Restore 'image/avif' once Next.js is on >= 15.5.24.
    formats: ['image/webp'],
  },
  // Phase 9 gap-fix follow-up (docs/adr/0001 section 18.11-18.12): belt-
  // and-suspenders alongside the require.resolve() fix in lib/pdf.ts.
  // These two API routes read @fontsource/heebo's .woff files via
  // pdfkit's registerFont(), which only reaches them through a runtime
  // fs.readFileSync - Vercel's Node File Trace can miss that even when
  // resolved through require.resolve(), so this explicitly guarantees
  // the files are copied into both routes' deployed serverless bundles
  // regardless of how reliably the tracer's heuristics detect the call.
  //
  // Next 15 graduated this out of `experimental` to a top-level option.
  // Leaving it nested did not fail the build - it only printed
  // "Unrecognized key(s) in object: 'outputFileTracingIncludes' at
  // 'experimental'" among the warnings - which is the dangerous kind of
  // breakage: the deploy succeeds, and the first sign of trouble is a
  // Hebrew PDF export throwing at runtime in production because the font
  // files were never traced into the bundle. Moved to the top level.
  outputFileTracingIncludes: {
    '/api/reports/export': ['./node_modules/@fontsource/heebo/files/heebo-{hebrew,latin}-400-normal.woff'],
    '/api/portal/export': ['./node_modules/@fontsource/heebo/files/heebo-{hebrew,latin}-400-normal.woff'],
  },
  // Phase 7 security hardening (spec 16.2, ADR addendum section 14.3).
  // Applied to every response. A Content-Security-Policy is deliberately
  // NOT included here yet - see the ADR addendum for why shipping an
  // untuned one is worse than shipping none.
  // SEO fix (docs/adr/0002 ("Marketing site — canonical host / indexing consistency fix")):
  // three historical/broken URLs Google Search Console still has indexed.
  // Vercel's own domain configuration already 301/308-redirects the bare
  // apex (ankora.co.il) to www.ankora.co.il, preserving the full path - that
  // redirect is NOT duplicated here to avoid an unnecessary redirect chain.
  // These are the only three URL-level redirects the app itself owns.
  async redirects() {
    return [
      // Old flat "/solutions/*" URLs predate locale-prefixed routing. The
      // equivalent current pages live at /he|en/solutions/*. Default to the
      // site's default locale (he), matching the existing "/" -> "/he"
      // redirect in vercel.json.
      {
        source: '/solutions/companies',
        destination: '/he/solutions/companies',
        statusCode: 301,
      },
      {
        source: '/solutions/executives',
        destination: '/he/solutions/executives',
        statusCode: 301,
      },
      // The Hebrew ESTA article's language toggle used to link to this slug
      // (assuming identical slugs across locales, which blog posts don't
      // guarantee - see lib/blog-translations.ts). Google crawled and
      // indexed it as a live 404. Redirect straight to the real article.
      {
        source: '/en/blog/esta',
        destination:
          '/en/blog/forgot-to-renew-your-esta-and-only-found-out-at-the-airport-here-s-what-to-do',
        statusCode: 301,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Security review (OWASP A05:2021 - Security Misconfiguration).
          // The note above is right that an untuned CSP is worse than
          // none - but "none at all" left the app with no second line of
          // defense behind React's escaping, and no restriction on where
          // an injected script could send data. This policy is tuned to
          // what the app actually loads, verified against production
          // traffic: every script, style, font and image is same-origin,
          // and the only third party anywhere is Google Analytics on the
          // marketing pages.
          //
          // script-src keeps 'unsafe-inline' deliberately. The App Router
          // emits inline bootstrap/hydration scripts on every page, and
          // components/seo/JsonLd.tsx plus the gtag snippet in
          // app/[locale]/layout.tsx are inline by nature. Removing it
          // needs per-request nonces, which needs middleware that runs on
          // every route - a real change with its own regression surface,
          // tracked as the follow-up in the security review PR.
          //
          // What this policy DOES buy, even with 'unsafe-inline':
          //   - connect-src stops an injected script from exfiltrating
          //     data to an attacker-controlled host, which is the payoff
          //     for most XSS in an app like this one.
          //   - script-src stops `<script src="https://evil/">` injection
          //     (the common stored-XSS shape) even though inline runs.
          //   - object-src 'none' kills Flash/applet-style vectors.
          //   - base-uri 'self' stops a <base> tag from silently
          //     re-pointing every relative script URL on the page.
          //   - form-action 'self' stops a credential form from being
          //     re-targeted at an attacker's collector.
          //   - frame-ancestors 'none' is the modern, and on some
          //     browsers the only respected, half of the clickjacking
          //     defense X-Frame-Options below provides.
          //
          // 'unsafe-eval' is added in development only: Next.js's hot
          // module replacement needs it, production never does. The test
          // is written as "is this explicitly development" rather than
          // "is this not production" on purpose - the first cut used the
          // latter and therefore emitted 'unsafe-eval' whenever NODE_ENV
          // happened to be unset, which is fail-OPEN. This way an
          // unexpected or missing NODE_ENV yields the strict policy.
          //
          // The PREVIEW_ORIGINS block below is the result of actually
          // loading a preview deployment under this policy rather than
          // assuming it worked. Vercel's Deployment Protection guards
          // preview URLs with an SSO round trip to vercel.com/sso-api,
          // and a first cut of this CSP blocked it - previews still
          // rendered, but the protection handshake threw a CSP violation,
          // which would have made reviewing every future PR awkward.
          // vercel.live is the preview comment toolbar, same story.
          //
          // These hosts are added ONLY when the build is not a production
          // build, so production keeps the strict policy and gets no
          // Vercel origins at all. VERCEL_ENV is injected by the platform
          // ('production' | 'preview' | 'development'); its absence means
          // a local build, which also wants the looser set.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              `form-action 'self'${PREVIEW_ORIGINS}`,
              "img-src 'self' data: blob: https://www.googletagmanager.com https://*.google-analytics.com",
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              `script-src 'self' 'unsafe-inline'${
                process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
              } https://www.googletagmanager.com${PREVIEW_ORIGINS}`,
              `connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com${PREVIEW_ORIGINS}`,
              `frame-src 'self'${PREVIEW_ORIGINS}`,
              'upgrade-insecure-requests',
            ].join('; '),
          },
          // Vercel already terminates TLS and forces HTTPS at the edge;
          // this is the "HSTS בפרודקשן" half of spec 16.2's requirement.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // No legitimate reason for this app to be framed by another
          // origin - closes a clickjacking vector.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
      // Security review. The Time Tracking app is a private, authenticated
      // product surface - nothing under /app should ever appear in a
      // search index. Middleware redirects unauthenticated crawlers to
      // /app/login, which is itself indexable as things stand, and an
      // indexed login page is free reconnaissance (it tells an attacker
      // the product exists, where it lives, and what it is called).
      {
        source: '/app/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          // Security review follow-up: a dedicated, strictly same-origin
          // policy for the authenticated product surface.
          //
          // Until now /app inherited the marketing policy above, which
          // allows https://www.googletagmanager.com as a SCRIPT source.
          // /app loads no analytics and, verified by grep, references no
          // external URL at all - so that allowance bought nothing and
          // cost something real: Google Tag Manager is a well-known CSP
          // bypass vector, because a GTM container can be configured to
          // load further arbitrary scripts. Leaving it whitelisted on the
          // surface that holds sessions, client data and the audit log
          // was the weakest line in the whole policy.
          //
          // Every directive here is 'self' or 'none' IN PRODUCTION. No
          // third-party origin is reachable from /app there.
          //
          // PREVIEW_ORIGINS is appended on preview/local builds only, for
          // the same reason it exists on the broad policy above: Vercel's
          // preview toolbar (vercel.live) and Deployment Protection
          // handshake (vercel.com) would otherwise be blocked, which was
          // verified happening on this very branch's first preview -
          // "Loading the script 'https://vercel.live/_next-live/feedback/
          // feedback.js' violates ... script-src 'self' 'unsafe-inline'".
          // Production keeps the strictly same-origin policy that is the
          // entire point of this rule.
          //
          // 'unsafe-inline' remains in script-src, and deliberately so.
          // Removing it needs a per-request nonce, which was investigated
          // and rejected - see docs/adr/0004 for the measurements. The
          // short version: the obvious implementation silently applies no
          // policy at all, and making it work means surgery on the auth
          // middleware for a vector this codebase does not have.
          //
          // Note both this rule and the '/:path*' rule above match a
          // request to /app. Whether Next emits one header or two, the
          // result is the same: this policy is a strict subset of the
          // broad one, so either it replaces it or the browser enforces
          // both and the intersection is this one. Fail-safe in either
          // direction - if this rule ever stops matching, /app simply
          // falls back to the broader policy rather than losing its CSP.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              `script-src 'self' 'unsafe-inline'${
                process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
              }${PREVIEW_ORIGINS}`,
              `connect-src 'self'${PREVIEW_ORIGINS}`,
              `frame-src ${PREVIEW_ORIGINS ? `'self'${PREVIEW_ORIGINS}` : "'none'"}`,
              'upgrade-insecure-requests',
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;

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
  experimental: {
    outputFileTracingIncludes: {
      '/api/reports/export': ['./node_modules/@fontsource/heebo/files/heebo-{hebrew,latin}-400-normal.woff'],
      '/api/portal/export': ['./node_modules/@fontsource/heebo/files/heebo-{hebrew,latin}-400-normal.woff'],
    },
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
          // module replacement needs it, production never does.
          // vercel.live is the Preview-deployment comment toolbar; it is
          // inert on production but listing it keeps previews usable.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "img-src 'self' data: blob: https://www.googletagmanager.com https://*.google-analytics.com",
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              `script-src 'self' 'unsafe-inline'${
                process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"
              } https://www.googletagmanager.com https://vercel.live`,
              "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://vercel.live",
              "frame-src 'self' https://vercel.live",
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
        ],
      },
    ];
  },
};

export default nextConfig;

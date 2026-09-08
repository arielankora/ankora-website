/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
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
    ];
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  // Phase 7 security hardening (spec 16.2, ADR addendum section 14.3).
  // Applied to every response. A Content-Security-Policy is deliberately
  // NOT included here yet - see the ADR addendum for why shipping an
  // untuned one is worse than shipping none.
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

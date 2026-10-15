import { securityTxt } from "@/lib/security-txt";

// Mapped onto /.well-known/security.txt and /security.txt by rewrites in
// next.config.mjs. See lib/security-txt.ts.
export const dynamic = "force-static";

export function GET() {
  return new Response(securityTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

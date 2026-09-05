"use client";

import { useEffect } from "react";

// Phase 7 (spec 20: "Network error עם Retry", ADR addendum 14.4). Catches
// any unhandled exception thrown while rendering a page under this route
// group (the product tool) so a bug never falls back to Next.js's bare
// default error screen. Rendered inside app/(product)/layout.tsx's own
// <html>/<body> (which stays mounted) - per Next.js's error.tsx
// convention, only global-error.tsx (for a crash in the root layout
// itself) needs its own html/body. Client Component because it needs
// onClick/useEffect. Does not log to an external service (ADR addendum
// 14.6 - no error-tracking provider chosen yet); logs to the server
// console only so it at least appears in Vercel's own function logs.
export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error in product app:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm rounded-2xl border border-lineDark bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold-dim">Ankora</p>
        <h1 className="mt-4 text-lg font-semibold text-navy">משהו השתבש</h1>
        <p className="mt-2 text-sm text-navy/60">
          אירעה תקלה בלתי צפויה. אפשר לנסות שוב, ואם זה חוזר - לפנות לתמיכה.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 w-full rounded-full bg-navy px-6 py-3 text-sm font-medium text-white"
        >
          ניסיון חוזר
        </button>
      </div>
    </div>
  );
}

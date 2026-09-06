import Link from "next/link";

// Phase 7 (spec 20/24, ADR addendum 14.4). Branded 404 for any unmatched
// path under /app/** - distinct from the marketing site's own not-found
// under app/[locale] (separate root layout, separate audience). Kept
// unauthenticated-safe: doesn't attempt to read the session or branch on
// role, so it renders correctly even for a logged-out visitor who
// mistyped a URL.
export default function ProductNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm rounded-2xl border border-lineDark bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gold-dim">Ankora</p>
        <h1 className="mt-4 text-lg font-semibold text-navy">הדף לא נמצא</h1>
        <p className="mt-2 text-sm text-navy/60">
          הכתובת שביקשתם לא קיימת, או שאין לכם הרשאה לצפות בה.
        </p>
        <Link
          href="/app"
          className="mt-6 block w-full rounded-full bg-navy px-6 py-3 text-sm font-medium text-white"
        >
          חזרה לדף הבית
        </Link>
      </div>
    </div>
  );
}

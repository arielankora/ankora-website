import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Phase 8 addendum: spec section 24's pre-production checklist item
// "Privacy links/terms in login/footer as needed" - this screen had
// neither. Links to the marketing site's own real privacy/terms pages
// (built earlier in this engagement, well before the time-tracking app
// existed) rather than duplicating that content here.
export default function LoginPage({ searchParams }: { searchParams: { passwordChanged?: string } }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-lineDark bg-white p-8 shadow-sm">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-dim">Ankora</span>
          <h1 className="mt-2 text-xl font-medium text-navy">ניהול שעות ובנקי שעות</h1>
        </div>
        {searchParams.passwordChanged === "1" && (
          // Phase 9 gap-fix: app/(product)/app/profile's self-service
          // password change redirects here (it invalidates every session,
          // including the current one - see lib/app-domain/profile.ts).
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-700">
            הסיסמה הוחלפה בהצלחה. יש להתחבר מחדש.
          </p>
        )}
        <LoginForm />
      </div>
      <p className="mt-6 text-xs text-navy/40">
        <Link href="/he/privacy" className="hover:text-navy/60">מדיניות פרטיות</Link>
        {" · "}
        <Link href="/he/terms" className="hover:text-navy/60">תנאי שימוש</Link>
      </p>
    </div>
  );
}

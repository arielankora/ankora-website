import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/app/AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// App redesign (handoff README, screen 17 "כניסה ושחזור סיסמה"): now built
// on the shared AuthShell (dark logo/positioning column + light form
// column). The privacy/terms links (Phase 8 addendum, spec 24's
// pre-production checklist) aren't in the prototype's own demo login
// screen, but they're a real compliance requirement this app already
// shipped - kept, just moved under the form instead of dropped.
export default async function LoginPage(props: { searchParams: Promise<{ passwordChanged?: string }> }) {
  const searchParams = await props.searchParams;
  return (
    <AuthShell>
      <p className="text-[22px] font-medium text-appNavy">כניסה למערכת</p>
      <p className="mb-6 mt-2 text-[13.5px] text-appNavy/60">התחברות עם כתובת המייל או שם המשתמש הארגוני.</p>

      {searchParams.passwordChanged === "1" && (
        // Phase 9 gap-fix: app/(product)/app/profile's self-service
        // password change redirects here (it invalidates every session,
        // including the current one - see lib/app-domain/profile.ts).
        <p className="mb-5 rounded-[10px] border border-success/30 bg-success-soft px-3 py-2.5 text-center text-[12.5px] text-success">
          הסיסמה הוחלפה בהצלחה. יש להתחבר מחדש.
        </p>
      )}

      <LoginForm />

      <p className="mt-8 text-center text-[11px] text-appNavy/40">
        <Link href="/he/privacy" className="hover:text-appNavy/60">
          מדיניות פרטיות
        </Link>
        {" · "}
        <Link href="/he/terms" className="hover:text-appNavy/60">
          תנאי שימוש
        </Link>
      </p>
    </AuthShell>
  );
}

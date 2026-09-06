import { requireUser } from "@/lib/app-auth/session";
import { AppShell } from "@/components/app/AppShell";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { TimezoneForm } from "./TimezoneForm";

export const metadata = { robots: { index: false, follow: false } };

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec §11): self-service
// Profile screen (timezone/password) while logged in - previously the
// only self-service path was the unauthenticated forgot-password flow.
// No permission gate: every role, including CLIENT_USER, may reach this
// screen and edit only their own row (see lib/app-domain/profile.ts).
export default async function ProfilePage() {
  const user = await requireUser();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">הפרופיל שלי</h1>
          <p className="mt-1 text-sm text-navy/60">
            {user.name} - {user.email}
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-navy/70">אזור זמן</h2>
          <TimezoneForm timezone={user.timezone} />
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-navy/70">החלפת סיסמה</h2>
          <ChangePasswordForm />
        </div>
      </div>
    </AppShell>
  );
}

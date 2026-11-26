import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { Forbidden } from "@/components/app/Forbidden";
import { SetupLayout } from "../setup/SetupLayout";
import { IdentityStep } from "../setup/SetupSteps";

export const metadata = { robots: { index: false, follow: false } };

// New-client wizard (26.11.2026), step 1 before the client exists: it is
// created, as ONBOARDING, when this step is saved.
export default async function NewClientPage() {
  const user = await requireUser();
  if (!can(user.role, "client.manage")) return <Forbidden />;
  return (
    <SetupLayout summary={null} current={1}>
      <IdentityStep state={null} />
    </SetupLayout>
  );
}

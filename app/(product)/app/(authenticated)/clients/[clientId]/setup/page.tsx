import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { Forbidden } from "@/components/app/Forbidden";
import { listStaffForAssignment } from "@/lib/app-domain/clients";
import { onboardingState } from "@/lib/app-domain/client-onboarding";
import { SetupLayout, type SetupStep } from "../../setup/SetupLayout";
import { ContactsStep, IdentityStep, LinkStep, RulesStep, SummaryStep } from "../../setup/SetupSteps";

export const metadata = { robots: { index: false, follow: false } };

function stepOf(value: string | undefined): SetupStep {
  if (value === "summary") return "summary";
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : 1;
}

// New-client wizard (26.11.2026): a client being set up, one step at a
// time. A client that is no longer being set up goes to its own screen.
export default async function ClientSetupPage(props: { params: Promise<{ clientId: string }>; searchParams?: Promise<{ step?: string }> }) {
  const { clientId } = await props.params;
  const step = stepOf((await props.searchParams)?.step);
  const user = await requireUser();
  if (!can(user.role, "client.manage")) return <Forbidden />;

  const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { status: true } });
  if (!client) notFound();
  if (client.status !== "ONBOARDING") redirect(`/app/clients/${clientId}`);

  const [state, staff] = await Promise.all([onboardingState(user, clientId), step === 4 ? listStaffForAssignment() : Promise.resolve([])]);
  const summary = {
    id: state.id,
    name: state.name,
    kind: state.kind,
    aiExcluded: state.aiExcluded,
    step: state.step,
    domains: state.domains.length,
    partners: state.partners.length,
    contacts: state.contacts.length,
    missing: state.missing.map((m) => ({ code: m.code, step: m.step })),
  };

  return (
    <SetupLayout summary={summary} current={step}>
      {step === 1 && <IdentityStep state={state} />}
      {step === 2 && <LinkStep state={state} />}
      {step === 3 && <ContactsStep state={state} />}
      {step === 4 && <RulesStep state={state} staff={staff} />}
      {step === "summary" && <SummaryStep state={state} />}
    </SetupLayout>
  );
}

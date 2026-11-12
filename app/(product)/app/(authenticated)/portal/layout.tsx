import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { resolvePortalClient } from "@/lib/app-domain/client-portal";
import { PortalContextBar } from "./PortalContextBar";
import { ScopedMessages } from "@/components/app/ScopedMessages";
import { NoMachineTranslation } from "@/components/app/NoMachineTranslation";

// Portal phase 0. The context bar belongs to all four portal screens, so
// it is resolved once here rather than repeated in each page. The layout
// deliberately does NOT block on a failure: a caller with no membership
// still reaches the page, which renders its own <Forbidden /> exactly as
// it did before - one screen, one refusal message, not two.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  let ctx = null;
  try {
    ctx = await resolvePortalClient(user);
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  // ADR 0006, decision 7: this area's part of the dictionary. A client
  // marked "בלי AI" gets every portal screen kept from the browser's
  // translator (ADR 0006, "Content in English"), here once for all of them.
  return (
    <ScopedMessages area="portal">
    <NoMachineTranslation active={!!ctx?.client.aiExcluded}>
    <div className="space-y-4">
      {ctx && (
        <PortalContextBar
          isStaffPreview={ctx.isStaffPreview}
          clientName={ctx.client.name}
          memberships={ctx.memberships}
          currentClientId={ctx.client.id}
        />
      )}
      {children}
    </div>
    </NoMachineTranslation>
    </ScopedMessages>
  );
}

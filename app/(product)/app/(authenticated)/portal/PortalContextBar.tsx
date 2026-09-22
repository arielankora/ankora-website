import { switchPortalClientAction, exitPortalPreviewAction } from "./actions";
import type { PortalMembership } from "@/lib/app-domain/client-portal";

// Portal phase 0. Two things that sit above every portal screen and are
// invisible in the ordinary case: the preview banner (only for an Ankora
// manager) and the client switcher (only for a portal user who belongs to
// more than one client). A client with one membership sees neither, which
// is the point - the portal must not grow chrome for the common case.

export function PortalContextBar({
  isStaffPreview,
  clientName,
  memberships,
  currentClientId,
}: {
  isStaffPreview: boolean;
  clientName: string;
  memberships: PortalMembership[];
  currentClientId: string;
}) {
  if (isStaffPreview) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-gold/40 bg-gold/10 px-4 py-3">
        <p className="text-[12.5px] text-appNavy">
          תצוגת לקוח: <span className="font-medium">{clientName}</span>. זה בדיוק מה שהלקוח רואה, וכל פעולה חסומה.
        </p>
        <form action={exitPortalPreviewAction}>
          <button
            type="submit"
            className="rounded-full border border-gold/50 bg-white px-3.5 py-1.5 text-[12px] text-appNavy hover:border-gold"
          >
            יציאה מהתצוגה
          </button>
        </form>
      </div>
    );
  }

  if (memberships.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-lineDark bg-white px-4 py-3">
      <span className="text-[12.5px] text-appNavy/60">התיק המוצג</span>
      {memberships.map((m) => (
        <form key={m.clientId} action={switchPortalClientAction}>
          <input type="hidden" name="clientId" value={m.clientId} />
          <button
            type="submit"
            aria-current={m.clientId === currentClientId ? "true" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors ${
              m.clientId === currentClientId
                ? "bg-appNavy text-cream"
                : "border border-lineDark text-appNavy hover:border-gold"
            }`}
          >
            {m.clientName}
          </button>
        </form>
      ))}
    </div>
  );
}

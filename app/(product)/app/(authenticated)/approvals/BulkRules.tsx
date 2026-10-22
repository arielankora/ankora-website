"use client";
import { useState, useTransition } from "react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { approveRulesTogetherAction } from "./actions";

// "לאשר את 3 הכללים של NUX": only rules already confirmed with the
// client, two or more of one client. A second click confirms, since it is
// several decisions at once.

export function BulkRules({ groups }: { groups: { clientId: string; clientName: string; ids: string[] }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="bulk-rules">
      {groups.map((g) => (
        <BulkRule key={g.clientId} group={g} />
      ))}
    </div>
  );
}

function BulkRule({ group }: { group: { clientId: string; clientName: string; ids: string[] } }) {
  const { showToast } = useToast();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const label = `לאשר את ${group.ids.length} הכללים של ${group.clientName}`;
  if (done) return <span className="rounded-full border border-app-border px-3 py-1 text-[12.5px] text-app-text-tertiary">{done}</span>;
  const run = () =>
    start(async () => {
      const r = await approveRulesTogetherAction(group.clientId, group.ids);
      if (r.error) {
        showToast({ tone: "error", title: "האישור נכשל", description: r.error });
        return;
      }
      const failed = r.failed ?? [];
      setDone(`${r.approved} כללים אושרו`);
      showToast({ tone: failed.length ? "info" : "success", title: `${r.approved} כללים אושרו`, description: failed.length ? `לא אושרו: ${failed.join("; ").slice(0, 200)}` : group.clientName });
    });
  return confirming ? (
    <span className="flex items-center gap-2 rounded-full border border-app-accent bg-app-accent-soft px-3 py-1 text-[12.5px]">
      <button type="button" disabled={pending} onClick={run} className="font-medium text-app-text-primary disabled:opacity-40">
        {pending ? "מאשר..." : `כן, ${label}`}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-app-text-tertiary hover:underline">
        ביטול
      </button>
    </span>
  ) : (
    <button type="button" onClick={() => setConfirming(true)} className="rounded-full border border-app-border bg-white px-3 py-1 text-[12.5px] text-app-text-primary hover:border-app-accent">
      {label}
    </button>
  );
}

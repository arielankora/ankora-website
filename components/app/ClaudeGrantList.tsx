"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { revokeMyClaudeGrantAction } from "@/app/(product)/app/(authenticated)/mcp-actions";

export type GrantRow = {
  id: string;
  label: string;
  /// Pre-formatted on the server ("בתוקף עד 12 בדצמבר 2026"), so this
  /// component never has to agree with the rest of the app about date
  /// formatting or about which timezone "today" means.
  expiresLabel: string | null;
  isBridge: boolean;
};

// The one interactive part of the Claude card: disconnecting a grant.
//
// Two decisions worth stating, because both are departures from what the
// rest of this app does by default.
//
// 1. Confirm before, not undo after. ToastProvider's rules ask every
//    destructive action for a real Undo. Un-revoking would resurrect a
//    credential the person just decided to kill, so instead the button
//    turns into an explicit "אישור ניתוק" that has to be pressed on its
//    own. The recovery path is honest and fast: authorize again in
//    Claude, which mints a fresh grant in seconds.
// 2. No window.confirm. A native modal blocks the page, looks nothing
//    like the rest of this UI, and is exactly the kind of interruption
//    the redesign removed everywhere else. Inline two-step costs one
//    extra click and stays inside the card.
export function ClaudeGrantList({ grants }: { grants: GrantRow[] }) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function revoke(grant: GrantRow) {
    setConfirmingId(null);
    startTransition(async () => {
      const result = await revokeMyClaudeGrantAction(grant.id);
      if (!result.ok) {
        showToast({ tone: "error", title: "הניתוק נכשל", description: result.error });
        return;
      }
      showToast({
        tone: "success",
        title: "החיבור נותק",
        description: `Claude כבר לא יכול לגשת לחשבון שלכם דרך "${grant.label}". לחיבור מחדש - אשרו שוב ב-Claude.`,
      });
    });
  }

  return (
    <ul className="space-y-2">
      {grants.map((grant) => {
        const confirming = confirmingId === grant.id;
        return (
          <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-appNavy/60">
            <span className="min-w-0">
              <span className="font-medium text-appNavy/80">
                {grant.label}
                {grant.isBridge ? " (גשר מקומי)" : ""}
              </span>
              {grant.expiresLabel && <span className="mr-2">בתוקף עד {grant.expiresLabel}</span>}
            </span>

            {confirming ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => revoke(grant)}
                  className="rounded-full bg-error-soft px-3 py-1 text-xs font-medium text-error transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  {pending ? "מנתק…" : "אישור ניתוק"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirmingId(null)}
                  className="rounded-full px-2 py-1 text-xs text-appNavy/50 hover:text-appNavy"
                >
                  ביטול
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmingId(grant.id)}
                className="rounded-full border border-lineDark px-3 py-1 text-xs font-medium text-appNavy/60 transition-colors hover:border-error hover:text-error disabled:opacity-50"
              >
                ניתוק
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

// 3.11.2026, Ariel: "לא רושמים בחבילה סגורה". Shown when a write lands in a
// closed hour bank. The person can record the time in the open bank
// instead (new entries only), and a manager can change the closed bank
// anyway, but only after the warning and with a reason. Every override is
// written to the audit log by the server. See lib/app-domain/closed-bank-guard.ts.

export type ClosedBankNoticeProps = {
  notice: { message: string; canMoveToOpen: boolean; canOverride: boolean; overrideWarning: string };
  onMoveToOpen?: () => void;
  onOverride: (reason: string) => void;
  onDismiss: () => void;
  moveLabel?: string;
};

export function ClosedBankNotice({ notice, onMoveToOpen, onOverride, onDismiss, moveLabel }: ClosedBankNoticeProps) {
  const t = useTranslations("myTime.closedBank");
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div
      role="alert"
      className="mt-3 rounded-[10px] border border-app-warning/35 bg-app-warning-soft px-3 py-2.5 text-[12.5px] text-app-warning"
    >
      <p>{notice.message}</p>
      {!confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {notice.canMoveToOpen && onMoveToOpen && (
            <button
              type="button"
              onClick={onMoveToOpen}
              className="rounded-full border border-app-warning/45 px-3.5 py-1.5 text-[12px] font-medium text-app-warning hover:bg-app-warning-soft"
            >
              {moveLabel ?? t("moveToOpen")}
            </button>
          )}
          {notice.canOverride && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-[12px] text-app-text-secondary underline hover:text-app-text-primary"
            >
              {t("overrideAnyway")}
            </button>
          )}
          <button type="button" onClick={onDismiss} className="text-[12px] text-app-text-secondary hover:text-app-text-primary">
            {t("cancel")}
          </button>
        </div>
      )}
      {confirming && (
        <div className="mt-2 space-y-2">
          <p className="font-medium">{notice.overrideWarning}</p>
          <label className="block">
            <span className="mb-1 block text-[11px] text-app-text-secondary">{t("reasonLabel")}</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-[9px] border border-app-border-strong bg-white px-2.5 py-2 text-[13px] text-app-text-primary outline-none focus:border-gold"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!reason.trim()}
              onClick={() => onOverride(reason.trim())}
              className="rounded-full border border-app-warning/45 px-3.5 py-1.5 text-[12px] font-medium text-app-warning hover:bg-app-warning-soft disabled:opacity-40"
            >
              {t("confirm")}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setReason("");
              }}
              className="text-[12px] text-app-text-secondary hover:text-app-text-primary"
            >
              {t("back")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

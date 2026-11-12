"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/app/toast/ToastProvider";
import { decideVendorCheckAction } from "./actions";

// P8 (3.11.2026): this task looks like connecting a new vendor to the app
// or the service Ankora gives clients. The same question Claude asks in
// the tools, for a task opened on the screen. Nobody answering for a
// business day opens the run anyway (lib/app-domain/vendor-detections.ts).

export function VendorCheckCard({ taskId, detectionId, vendor, matched }: { taskId: string; detectionId: string; vendor: string | null; matched: string }) {
  const t = useTranslations("tasks.detail.vendor");
  const { showToast } = useToast();
  const [name, setName] = useState(vendor ?? "");
  const [pending, setPending] = useState(false);

  async function decide(decision: "OPEN_RUN" | "NOT_A_VENDOR") {
    if (pending) return;
    setPending(true);
    const result = await decideVendorCheckAction({ taskId, detectionId, decision, vendor: name.trim() || null });
    setPending(false);
    if (!result.ok) {
      showToast({ tone: "error", title: t("notSaved"), description: result.error });
      return;
    }
    showToast({
      tone: "success",
      title: result.status === "OPENED" ? t("opened") : result.status === "EXISTING" ? t("existing") : t("notVendorSaved"),
    });
  }

  return (
    <section className="rounded-2xl border border-gold/40 bg-gold/[0.04] p-5" data-testid="vendor-check">
      <h2 className="text-sm font-medium text-app-text-primary">{t("title")}</h2>
      <p className="mt-1 text-xs text-app-text-secondary">
        {t("body", { matched })}
      </p>
      <label className="mt-3 block text-xs text-app-text-secondary">
        {t("name")}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          dir="auto"
          className="mt-1 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() => decide("OPEN_RUN")}
          className="min-h-[44px] rounded-full bg-app-accent px-5 py-2 text-sm font-medium text-app-text-primary disabled:opacity-50"
        >
          {t("openRun")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("NOT_A_VENDOR")}
          className="min-h-[44px] text-sm text-app-text-secondary hover:text-app-text-primary disabled:opacity-50"
        >
          {t("notVendor")}
        </button>
      </div>
    </section>
  );
}

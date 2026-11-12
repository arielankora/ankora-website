"use client";
import { useTranslations } from "next-intl";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { approveGuideAction, proposeGuideAction, rejectGuideAction } from "./actions";

const INPUT = "mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";

function ProposeForm({ current }: { current: string }) {
  const t = useTranslations("extractionGuide");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(proposeGuideAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">{t("propose.bodyLabel")}</span>
        <textarea name="body" rows={14} dir="auto" defaultValue={current} className={INPUT} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">{t("propose.noteLabel")}</span>
        <input name="note" required dir="auto" placeholder={t("propose.notePlaceholder")} className={INPUT} />
      </label>
      <p className="-mt-2 text-[11px] text-app-text-tertiary">{t("propose.enforced")}</p>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("propose.submit")}
      </button>
    </form>
  );
}

function RejectForm({ id }: { id: string }) {
  const t = useTranslations("extractionGuide");
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectGuideAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">{t("decide.reasonLabel")}</span>
        <input name="reason" required dir="auto" className={INPUT} />
      </label>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? t("saving") : t("decide.reject")}
      </button>
    </form>
  );
}

export function ProposeGuide({ current }: { current: string }) {
  const t = useTranslations("extractionGuide.propose");
  return (
    <Drawer triggerLabel={t("trigger")} title={t("title")} variant="link">
      <ProposeForm current={current} />
    </Drawer>
  );
}

export function DecideGuide({ id }: { id: string }) {
  const t = useTranslations("extractionGuide.decide");
  const { showToast } = useToast();
  async function approve() {
    const r = await approveGuideAction(id);
    if (r.error) showToast({ tone: "error", title: t("approveFailed"), description: r.error });
    else showToast({ tone: "info", title: t("approved"), description: t("approvedBody") });
  }
  return (
    <div className="flex items-center gap-3 text-xs">
      <button type="button" onClick={approve} className="rounded-full bg-app-accent px-3.5 py-1.5 font-medium text-app-text-primary">
        {t("approve")}
      </button>
      <Drawer triggerLabel={t("reject")} title={t("rejectTitle")} variant="link">
        <RejectForm id={id} />
      </Drawer>
    </div>
  );
}

"use client";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { approveGuideAction, proposeGuideAction, rejectGuideAction } from "./actions";

const INPUT = "mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";

function ProposeForm({ current }: { current: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(proposeGuideAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">ההנחיות, הנחיה בשורה</span>
        <textarea name="body" rows={14} defaultValue={current} className={INPUT} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">מה השתנה ולמה *</span>
        <input name="note" required placeholder="הוספתי דוגמה לשאלה פתוחה" className={INPUT} />
      </label>
      <p className="-mt-2 text-[11px] text-app-text-tertiary">מה שהשרת אוכף (חובת מקור, בלי סודות, לא דורסים) נשאר בקוד, ושום גרסה לא משנה אותו.</p>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "שליחה לאישור"}
      </button>
    </form>
  );
}

function RejectForm({ id }: { id: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectGuideAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">למה, בשורה אחת *</span>
        <input name="reason" required className={INPUT} />
      </label>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "דחייה"}
      </button>
    </form>
  );
}

export function ProposeGuide({ current }: { current: string }) {
  return (
    <Drawer triggerLabel="הצעת גרסה חדשה" title="גרסה חדשה של ההנחיות" variant="link">
      <ProposeForm current={current} />
    </Drawer>
  );
}

export function DecideGuide({ id }: { id: string }) {
  const { showToast } = useToast();
  async function approve() {
    const r = await approveGuideAction(id);
    if (r.error) showToast({ tone: "error", title: "האישור נכשל", description: r.error });
    else showToast({ tone: "info", title: "הגרסה אושרה", description: "מעכשיו כל פרומט חילוץ נושא אותה." });
  }
  return (
    <div className="flex items-center gap-3 text-xs">
      <button type="button" onClick={approve} className="rounded-full bg-app-accent px-3.5 py-1.5 font-medium text-app-text-primary">
        אישור
      </button>
      <Drawer triggerLabel="דחייה" title="דחיית גרסה" variant="link">
        <RejectForm id={id} />
      </Drawer>
    </div>
  );
}

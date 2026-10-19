"use client";
import { useEffect, useState } from "react";
import { loadPrepaidPackageAction, previewPrepaidLoadAction, type LoadPreviewState } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { parseHoursInput } from "@/lib/hours-input";
import { formatDecimalHours } from "@/lib/hours-format";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";

function todayInIsrael(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

// 12.10.2026 (RIMED): load a prepaid package of hours. The sum is shown
// before it is saved, from the same function that saves it.
export function LoadPackageForm({ clientId }: { clientId: string }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(loadPrepaidPackageAction, close);
  const [purchaseDate, setPurchaseDate] = useState(todayInIsrael());
  const [hours, setHours] = useState("");
  const [preview, setPreview] = useState<LoadPreviewState | null>(null);

  useEffect(() => {
    let live = true;
    if (!purchaseDate) {
      setPreview(null);
      return;
    }
    previewPrepaidLoadAction(clientId, purchaseDate).then((p) => {
      if (live) setPreview(p);
    });
    return () => {
      live = false;
    };
  }, [clientId, purchaseDate]);

  const purchased = parseHoursInput(hours);
  const carry = preview?.carryInMinutes ?? 0;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="clientId" value={clientId} />

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">תאריך רכישה *</label>
        <input
          type="date"
          name="purchaseDate"
          required
          max={todayInIsrael()}
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-[11px] text-app-text-tertiary">
          החבילה נספרת מתחילת היום הזה. החבילה או המחזור הקודמים נסגרים באותו רגע, כך שכל דיווח נספר פעם אחת.
        </p>
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">שעות שנרכשו *</label>
        <input
          name="purchasedHours"
          inputMode="decimal"
          dir="ltr"
          placeholder="30 או 12.5"
          required
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-app-text-secondary">בתוקף עד</label>
        <input type="date" name="expiresAt" className={inputClass} />
        <p className="mt-1 text-[11px] text-app-text-tertiary">ריק: שנה מתאריך הרכישה.</p>
      </div>

      {preview?.error ? (
        <p className="text-sm text-app-error">{preview.error}</p>
      ) : (
        preview && (
          <div className="rounded-xl bg-app-surface-sunken px-4 py-3 text-[12.5px] leading-relaxed text-app-text-primary">
            {preview.previous ? (
              <p>
                {preview.previous.kind === "PREPAID" ? "יתרה בחבילה הקודמת: " : "יתרה במחזור הקודם: "}
                <bdi dir="ltr" className={`font-jbmono ${preview.previous.balanceMinutes < 0 ? "text-app-error" : ""}`}>
                  {formatDecimalHours(preview.previous.balanceMinutes)}
                </bdi>
                {preview.previous.balanceMinutes < 0 && " (חריגה, תקוזז מהחבילה החדשה)"}
                {!preview.previous.stillValid && preview.previous.balanceMinutes > 0 && " (פג תוקף, לא עוברת)"}
              </p>
            ) : (
              <p>זו החבילה הראשונה של הלקוח.</p>
            )}
            {purchased ? (
              <p className="mt-1">
                זמין בחבילה החדשה:{" "}
                <bdi dir="ltr" className="font-jbmono">
                  {formatDecimalHours(purchased)} {carry < 0 ? "-" : "+"} {formatDecimalHours(Math.abs(carry))} ={" "}
                  {formatDecimalHours(purchased + carry)}
                </bdi>
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-app-text-tertiary">
              התראות ב-80% מ-{purchased ? formatDecimalHours(purchased) : "השעות"} שנטענו, ושוב כשהשעות נגמרות.
            </p>
          </div>
        )
      )}

      {error && <p className="text-sm text-app-error">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
      >
        {pending ? "טוען..." : "טעינת חבילה"}
      </button>
    </form>
  );
}

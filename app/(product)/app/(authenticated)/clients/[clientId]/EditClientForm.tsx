"use client";
import { updateClientAction } from "../actions";
import { useActionForm } from "@/components/app/useActionForm";
import { formatMinor } from "@/lib/money";
import type { Client } from "@prisma/client";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
    >
      {pending ? "נשמר..." : "שמירת שינויים"}
    </button>
  );
}

export function EditClientForm({
  client,
  staff,
}: {
  client: Client;
  /// Portal phase 2: who can be this client's account manager. Ankora
  /// staff only - a client user on that list would end up named as the
  /// person to talk to on their own portal.
  staff: { id: string; name: string }[];
}) {
  const { onSubmit, pending, error, ok } = useActionForm(updateClientAction);

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="clientId" value={client.id} />
      <div>
        <label className="block text-xs font-medium text-appNavy/60">שם הלקוח</label>
        <input
          name="name"
          defaultValue={client.name}
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">שם משפטי</label>
        <input
          name="legalName"
          defaultValue={client.legalName ?? ""}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">איש קשר</label>
        <input
          name="primaryContact"
          defaultValue={client.primaryContact ?? ""}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">אזור זמן</label>
        <input
          name="timezone"
          defaultValue={client.timezone}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">סטטוס</label>
        <select
          name="status"
          defaultValue={client.status}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        >
          <option value="ACTIVE">פעיל</option>
          <option value="PAUSED">מושהה</option>
          <option value="ARCHIVED">בארכיון</option>
        </select>
      </div>

      {/* Portal phase 2. Three fields that only matter because of the
          portal, grouped so they read as one subject rather than as more
          client settings. */}
      <div className="rounded-lg border border-lineDark bg-cream-dim/40 p-4 sm:col-span-2">
        <p className="text-xs font-medium text-appNavy">פורטל הלקוח</p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="block text-xs font-medium text-appNavy/60">מנהל התיק</span>
            <select
              name="accountManagerId"
              defaultValue={client.accountManagerId ?? ""}
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
            >
              <option value="">לא הוגדר</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-appNavy/45">מופיע בפורטל כשם האדם שאחראי על התיק.</span>
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-appNavy/60">וואטסאפ ייעודי</span>
            <input
              name="whatsappNumber"
              dir="ltr"
              defaultValue={client.whatsappNumber ?? ""}
              placeholder="052-000-0000"
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-end text-sm text-appNavy outline-none focus:border-gold"
            />
            <span className="mt-1 block text-[11px] text-appNavy/45">
              הקו שהלקוח כבר מתכתב איתו. ריק: הפורטל יציג שהערוץ עוד לא מחובר.
            </span>
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-appNavy/60">תקרת אישור (₪)</span>
            <input
              name="approvalCeiling"
              dir="ltr"
              inputMode="decimal"
              defaultValue={client.approvalCeilingMinor !== null ? String(client.approvalCeilingMinor / 100) : ""}
              placeholder="500"
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-end text-sm text-appNavy outline-none focus:border-gold"
            />
            <span className="mt-1 block text-[11px] text-appNavy/45">
              {client.approvalCeilingMinor !== null
                ? `כרגע: ${formatMinor(client.approvalCeilingMinor)}. מעל הסכום הזה נדרש אישור הלקוח.`
                : "ריק: כל החלטה עם סכום תוצג כדורשת אישור."}
            </span>
          </label>
        </div>
      </div>

      {/* Portal phase 3. The same three answers the client sees on their
          own screen, editable here because half of what is worth
          recording is said on a call and never typed by the person who
          said it. Changing one here does not send the client a
          notification - the notice goes the other way, to the account
          manager, when the CLIENT edits. */}
      <div className="sm:col-span-2">
        <p className="text-xs font-medium text-appNavy/60">העדפות שירות</p>
        <p className="mt-1 text-[11px] text-appNavy/45">
          מופיע ללקוח במסך &quot;התיק שלי&quot;, והוא יכול לערוך שם בעצמו.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="block text-[11px] text-appNavy/55">איך לדבר איתו</span>
            <textarea
              name="preferenceContact"
              rows={2}
              defaultValue={client.preferenceContact ?? ""}
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-appNavy/55">מה חשוב לו</span>
            <textarea
              name="preferenceMatters"
              rows={2}
              defaultValue={client.preferenceMatters ?? ""}
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-appNavy/55">מה אסור שיקרה</span>
            <textarea
              name="preferenceNever"
              rows={2}
              defaultValue={client.preferenceNever ?? ""}
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:col-span-2">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {ok && <p className="text-sm text-emerald-700">נשמר בהצלחה.</p>}
        <div className="ms-auto">
          <SubmitButton pending={pending} />
        </div>
      </div>
    </form>
  );
}

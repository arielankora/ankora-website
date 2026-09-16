"use client";
import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createImportantDateAction, updateImportantDateAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";
import { IMPORTANT_DATE_CATEGORY_LABELS, IMPORTANT_DATE_TYPE_EXAMPLES, type ImportantDateCategoryLike } from "@/lib/app-domain/important-dates-reminders";

type Client = { id: string; name: string };
type UserOption = { id: string; name: string; role: string };
type Category = { id: string; name: string; clientId: string | null };

export interface ExistingImportantDate {
  id: string;
  clientId: string;
  title: string;
  type: string;
  category: ImportantDateCategoryLike;
  relatedEntityType: string | null;
  relatedEntityName: string | null;
  relationToClient: string | null;
  calendarType: "GREGORIAN" | "HEBREW";
  month: number;
  day: number;
  originYear: number | null;
  recurrence: "ONCE" | "ANNUAL" | "MONTHLY" | "CUSTOM_INTERVAL";
  customIntervalDays: number | null;
  onceDate: Date | null;
  responsibleUserId: string;
  extraEmailRecipients: string[];
  sensitivity: "NORMAL" | "SENSITIVE";
  notes: string | null;
  createAutoTask: boolean;
  autoTaskLeadDays: number | null;
  autoTaskCategoryId: string | null;
  updatedAt: Date;
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

// Phase 10 ("מועדים חשובים") create/edit side panel. Mirrors
// app/(product)/app/(authenticated)/tasks/CreateTaskForm.tsx's
// client-then-category picker + Drawer-close-on-success pattern, extended
// for this entity's larger field set. When `existing` is passed, the form
// runs in edit mode (updateImportantDateAction, with the Phase 7
// expectedUpdatedAt optimistic-concurrency field - see
// lib/app-domain/important-dates.ts's ConflictError); otherwise it creates
// (createImportantDateAction, with a "use default reminders for this
// category" checkbox since a brand-new date has no ReminderRules yet).
export function ImportantDateForm({
  clients,
  users,
  categories,
  existing,
}: {
  clients: Client[];
  users: UserOption[];
  categories: Category[];
  existing?: ExistingImportantDate;
}) {
  const isEdit = Boolean(existing);
  const action = isEdit ? updateImportantDateAction : createImportantDateAction;
  const [state, formAction] = useFormState(action, {});
  const [clientId, setClientId] = useState(existing?.clientId ?? "");
  const [category, setCategory] = useState<ImportantDateCategoryLike | "">(existing?.category ?? "");
  const [calendarType, setCalendarType] = useState(existing?.calendarType ?? "GREGORIAN");
  const [recurrence, setRecurrence] = useState(existing?.recurrence ?? "ANNUAL");
  const [createAutoTask, setCreateAutoTask] = useState(existing?.createAutoTask ?? false);
  const close = useDrawerClose();

  useEffect(() => {
    if (state?.ok) close();
  }, [state, close]);

  const typeExamples = useMemo(() => (category ? IMPORTANT_DATE_TYPE_EXAMPLES[category] : []), [category]);
  const availableAutoTaskCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit && existing && (
        <>
          <input type="hidden" name="id" value={existing.id} />
          <input type="hidden" name="expectedUpdatedAt" value={existing.updatedAt.toISOString()} />
        </>
      )}

      <div>
        <label className="block text-xs font-medium text-navy/60">לקוח *</label>
        <select
          name="clientId"
          required
          value={clientId}
          disabled={isEdit}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold disabled:opacity-60"
        >
          <option value="">בחירת לקוח</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-navy/60">כותרת *</label>
        <input
          name="title"
          required
          defaultValue={existing?.title}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-navy/60">קטגוריה *</label>
          <select
            name="category"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value as ImportantDateCategoryLike)}
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          >
            <option value="">בחירה</option>
            {Object.entries(IMPORTANT_DATE_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-navy/60">סוג</label>
          <input
            name="type"
            list="important-date-type-examples"
            defaultValue={existing?.type}
            placeholder="לדוגמה: יום הולדת"
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          />
          <datalist id="important-date-type-examples">
            {typeExamples.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-navy/60">לוח שנה</label>
          <select
            name="calendarType"
            value={calendarType}
            onChange={(e) => setCalendarType(e.target.value as "GREGORIAN" | "HEBREW")}
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          >
            <option value="GREGORIAN">לועזי</option>
            <option value="HEBREW">עברי</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-navy/60">חזרתיות</label>
          <select
            name="recurrence"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as typeof recurrence)}
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          >
            <option value="ANNUAL">שנתי</option>
            <option value="MONTHLY">חודשי</option>
            <option value="ONCE">חד-פעמי</option>
            <option value="CUSTOM_INTERVAL">מרווח מותאם (ימים)</option>
          </select>
        </div>
      </div>

      {recurrence === "ONCE" ? (
        <div>
          <label className="block text-xs font-medium text-navy/60">תאריך *</label>
          <input
            type="date"
            name="onceDate"
            required
            defaultValue={toDateInputValue(existing?.onceDate ?? null)}
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
          />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-navy/60">
              {calendarType === "HEBREW" ? "חודש עברי (1-13)" : "חודש"}
            </label>
            <input
              type="number"
              name="month"
              min={1}
              max={13}
              required
              defaultValue={existing?.month}
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            />
            {calendarType === "HEBREW" && (
              <p className="mt-1 text-[11px] text-navy/40">1=ניסן ... 7=תשרי ... 12=אדר (א׳) ... 13=אדר ב׳</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-navy/60">יום</label>
            <input
              type="number"
              name="day"
              min={1}
              max={31}
              required
              defaultValue={existing?.day}
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            />
          </div>
          {recurrence === "CUSTOM_INTERVAL" ? (
            <div>
              <label className="block text-xs font-medium text-navy/60">כל כמה ימים</label>
              <input
                type="number"
                name="customIntervalDays"
                min={1}
                defaultValue={existing?.customIntervalDays ?? undefined}
                className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-navy/60">שנת מקור (אופציונלי)</label>
              <input
                type="number"
                name="originYear"
                defaultValue={existing?.originYear ?? undefined}
                placeholder="למשל 1990"
                className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
              />
            </div>
          )}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-navy/60">אחראי *</label>
        <select
          name="responsibleUserId"
          required
          defaultValue={existing?.responsibleUserId}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="">בחירת אחראי</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-navy/60">רגישות</label>
        <select
          name="sensitivity"
          defaultValue={existing?.sensitivity ?? ""}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        >
          <option value="">ברירת מחדל לפי קטגוריה</option>
          <option value="NORMAL">רגיל</option>
          <option value="SENSITIVE">רגיש (גלוי לאחראי ומנהלים בלבד)</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-navy/60">הערות</label>
        <textarea
          name="notes"
          rows={2}
          defaultValue={existing?.notes ?? ""}
          placeholder="לעולם לא לרשום כאן מספרי דרכון/מסמך או פרטים רפואיים מפורטים."
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="createAutoTask"
          name="createAutoTask"
          checked={createAutoTask}
          onChange={(e) => setCreateAutoTask(e.target.checked)}
          className="h-4 w-4 rounded border-lineDark"
        />
        <label htmlFor="createAutoTask" className="text-sm text-navy">
          ליצור משימה אוטומטית לפני המועד
        </label>
      </div>

      {createAutoTask && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-navy/60">כמה ימים לפני</label>
            <input
              type="number"
              name="autoTaskLeadDays"
              min={0}
              defaultValue={existing?.autoTaskLeadDays ?? 7}
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy/60">קטגוריית המשימה</label>
            <select
              name="autoTaskCategoryId"
              defaultValue={existing?.autoTaskCategoryId ?? ""}
              className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            >
              <option value="">ללא קטגוריה</option>
              {availableAutoTaskCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!isEdit && (
        <div className="flex items-center gap-2">
          <input type="checkbox" id="useDefaultReminders" name="useDefaultReminders" defaultChecked className="h-4 w-4 rounded border-lineDark" />
          <label htmlFor="useDefaultReminders" className="text-sm text-navy">
            להוסיף תזכורות ברירת מחדל לפי הקטגוריה
          </label>
        </div>
      )}

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <SubmitButton label={isEdit ? "שמירת שינויים" : "הוספת מועד"} pendingLabel={isEdit ? "שומר..." : "נוצר..."} />
    </form>
  );
}

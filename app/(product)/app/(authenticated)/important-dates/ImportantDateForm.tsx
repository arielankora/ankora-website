"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { createImportantDateAction, updateImportantDateAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import type { ImportantDateCategoryLike } from "@/lib/app-domain/important-dates-reminders";

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
  recurrence: "ONCE" | "ANNUAL" | "MONTHLY" | "CUSTOM_INTERVAL" | "WEEKLY" | "BUSINESS_DAILY";
  customIntervalDays: number | null;
  onceDate: Date | null;
  responsibleUserId: string;
  extraEmailRecipients: string[];
  sensitivity: "NORMAL" | "SENSITIVE";
  notes: string | null;
  createAutoTask: boolean;
  autoTaskLeadDays: number | null;
  autoTaskCategoryId: string | null;
  weekday: number | null;
  intervalMonths: number | null;
  leadUnit: "CALENDAR_DAYS" | "BUSINESS_DAYS";
  rollConvention: "NONE" | "PREVIOUS_BUSINESS_DAY" | "NEXT_BUSINESS_DAY";
  businessCalendar: string;
  /// Set when the date starts a process that decides its calendar: why.
  calendarLockedBy?: string | null;
  precision: "EXACT" | "APPROXIMATE" | "UNKNOWN";
  dayAlternatives: number[];
  conditionText: string | null;
  expectsReceipt?: boolean;
  expectedFrom?: string | null;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  updatedAt: Date;
}

// Org-brain spec 3.10 (13.10.2026). The words are the dictionary's
// (importantDates.form.*, ADR 0006); the values are what the form posts.
// Weekdays are named from the dictionary rather than a formatter, so the
// Hebrew keeps "ראשון" and not the formatter's "יום ראשון".
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const INTERVAL_MONTH_OPTIONS = [1, 2, 3, 4, 6] as const;
const CATEGORIES: ImportantDateCategoryLike[] = ["PEOPLE_FAMILY", "DOCUMENTS_AUTHORITIES", "BUSINESS_FINANCE", "VEHICLE_PROPERTY", "HEALTH_TRAVEL", "GENERAL"];

/// Suggestions for the free-text "type" field, per category, in the
/// reader's language. The Hebrew is IMPORTANT_DATE_TYPE_EXAMPLES in
/// important-dates-reminders.ts; whatever is picked is stored as typed.
const TYPE_EXAMPLE_KEYS = {
  PEOPLE_FAMILY: ["birthday", "anniversary", "memorial"],
  DOCUMENTS_AUTHORITIES: ["passportExpiry", "visaExpiry", "licenseRenewal", "idRenewal"],
  BUSINESS_FINANCE: ["contractRenewal", "taxPayment", "annualReport", "depositMaturity"],
  VEHICLE_PROPERTY: ["carInsurance", "vehicleTest", "homeInsurance", "propertyTax"],
  HEALTH_TRAVEL: ["checkup", "flight", "travelInsurance"],
  GENERAL: ["general"],
} as const satisfies Record<ImportantDateCategoryLike, readonly string[]>;

function SubmitButton({ label, pendingLabel, pending }: { label: string; pendingLabel: string; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
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
  const t = useTranslations("importantDates");
  const isEdit = Boolean(existing);
  const action = isEdit ? updateImportantDateAction : createImportantDateAction;
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(action, close);
  const [clientId, setClientId] = useState(existing?.clientId ?? "");
  const [category, setCategory] = useState<ImportantDateCategoryLike | "">(existing?.category ?? "");
  const [calendarType, setCalendarType] = useState(existing?.calendarType ?? "GREGORIAN");
  const [recurrence, setRecurrence] = useState(existing?.recurrence ?? "ANNUAL");
  const [precision, setPrecision] = useState(existing?.precision ?? "EXACT");
  // Org-brain spec 3.10: an approximate or unknown day only makes sense for
  // a date that repeats by the calendar.
  const precisionApplies = recurrence === "ANNUAL" || recurrence === "MONTHLY";
  const effectivePrecision = precisionApplies ? precision : "EXACT";
  const [createAutoTask, setCreateAutoTask] = useState(existing?.createAutoTask ?? false);

  const typeExamples = category ? TYPE_EXAMPLE_KEYS[category].map((key) => t(`typeExamples.${key}`)) : [];
  const availableAutoTaskCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {isEdit && existing && (
        <>
          <input type="hidden" name="id" value={existing.id} />
          <input type="hidden" name="expectedUpdatedAt" value={existing.updatedAt.toISOString()} />
        </>
      )}

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("form.client")}</label>
        <select
          name="clientId"
          required
          value={clientId}
          disabled={isEdit}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold disabled:opacity-60"
        >
          <option value="">{t("form.chooseClient")}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id} dir="auto">
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("form.title")}</label>
        <input
          name="title"
          dir="auto"
          required
          defaultValue={existing?.title}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.category")}</label>
          <select
            name="category"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value as ImportantDateCategoryLike)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            <option value="">{t("form.choose")}</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`category.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.type")}</label>
          <input
            name="type"
            dir="auto"
            list="important-date-type-examples"
            defaultValue={existing?.type}
            placeholder={t("form.typePlaceholder")}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          />
          <datalist id="important-date-type-examples">
            {typeExamples.map((example) => (
              <option key={example} value={example} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.calendar")}</label>
          <select
            name="calendarType"
            value={calendarType}
            onChange={(e) => setCalendarType(e.target.value as "GREGORIAN" | "HEBREW")}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            <option value="GREGORIAN">{t("form.gregorian")}</option>
            <option value="HEBREW">{t("form.hebrew")}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.recurrence")}</label>
          <select
            name="recurrence"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as typeof recurrence)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            {(["ANNUAL", "MONTHLY", "ONCE", "WEEKLY", "BUSINESS_DAILY", "CUSTOM_INTERVAL"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`form.recurrenceOptions.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {precisionApplies && (
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.precision")}</label>
          <select
            name="precision"
            value={precision}
            onChange={(e) => setPrecision(e.target.value as typeof precision)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            {(["EXACT", "APPROXIMATE", "UNKNOWN"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`form.precisionOptions.${value}`)}
              </option>
            ))}
          </select>
        </div>
      )}
      {!precisionApplies && <input type="hidden" name="precision" value="EXACT" />}

      {effectivePrecision === "UNKNOWN" ? (
        <div className="rounded-lg border border-dashed border-app-border px-3 py-2 text-xs text-app-text-secondary">
          {/* month/day are NOT NULL and ignored for an unknown date. */}
          <input type="hidden" name="month" value={existing?.month ?? 1} />
          <input type="hidden" name="day" value={existing?.day ?? 1} />
          {t("form.unknownHint")}
        </div>
      ) : recurrence === "BUSINESS_DAILY" ? (
        <div className="rounded-lg border border-dashed border-app-border px-3 py-2 text-xs text-app-text-secondary">
          {/* month/day are NOT NULL and ignored for a daily date, like WEEKLY. */}
          <input type="hidden" name="month" value="1" />
          <input type="hidden" name="day" value="1" />
          {t("form.businessDailyHint")}
          {calendarType === "HEBREW" && <span className="mt-1 block text-[11px] text-app-error">{t("form.businessDailyGregorian")}</span>}
        </div>
      ) : recurrence === "WEEKLY" ? (
        <div>
          {/* month/day are NOT NULL and ignored for a weekly date, like ONCE. */}
          <input type="hidden" name="month" value="1" />
          <input type="hidden" name="day" value="1" />
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.weekday")}</label>
          <select
            name="weekday"
            required
            defaultValue={existing?.weekday ?? 4}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            {WEEKDAY_KEYS.map((key, i) => (
              <option key={key} value={i}>
                {t(`form.weekdays.${key}`)}
              </option>
            ))}
          </select>
          {calendarType === "HEBREW" && <p className="mt-1 text-[11px] text-app-error">{t("form.weeklyGregorian")}</p>}
        </div>
      ) : recurrence === "ONCE" ? (
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.date")}</label>
          <input
            type="date"
            name="onceDate"
            required
            defaultValue={toDateInputValue(existing?.onceDate ?? null)}
            className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-app-text-secondary">
              {calendarType === "HEBREW" ? t("form.hebrewMonth") : t("form.month")}
            </label>
            <input
              type="number"
              name="month"
              min={1}
              max={13}
              required
              defaultValue={existing?.month}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
            {calendarType === "HEBREW" && (
              <p className="mt-1 text-[11px] text-app-text-tertiary">{t("form.hebrewMonthHint")}</p>
            )}
          </div>
          {effectivePrecision === "APPROXIMATE" ? (
            <div>
              {/* The domain stores the earliest alternative as `day`. */}
              <input type="hidden" name="day" value="1" />
              <label className="block text-xs font-medium text-app-text-secondary">{t("form.dayAlternatives")}</label>
              <input
                type="text"
                name="dayAlternatives"
                required
                inputMode="numeric"
                placeholder="8, 9"
                defaultValue={existing?.dayAlternatives?.join(", ") ?? ""}
                className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-app-text-secondary">{t("form.day")}</label>
              <input
                type="number"
                name="day"
                min={1}
                max={31}
                required
                defaultValue={existing?.day}
                className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
              />
            </div>
          )}
          {recurrence === "MONTHLY" && calendarType === "GREGORIAN" ? (
            <div>
              <label className="block text-xs font-medium text-app-text-secondary">{t("form.intervalMonths")}</label>
              <select
                name="intervalMonths"
                defaultValue={existing?.intervalMonths ?? 1}
                className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
              >
                {INTERVAL_MONTH_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {t(`form.intervalOptions.m${value}`)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-app-text-tertiary">{t("form.intervalHint")}</p>
            </div>
          ) : recurrence === "CUSTOM_INTERVAL" ? (
            <div>
              <label className="block text-xs font-medium text-app-text-secondary">{t("form.customIntervalDays")}</label>
              <input
                type="number"
                name="customIntervalDays"
                min={1}
                defaultValue={existing?.customIntervalDays ?? undefined}
                className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-app-text-secondary">{t("form.originYear")}</label>
              <input
                type="number"
                name="originYear"
                defaultValue={existing?.originYear ?? undefined}
                placeholder={t("form.originYearPlaceholder")}
                className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
              />
            </div>
          )}
        </div>
      )}

      {/* Spec 3.10: something due to reach us on the date. */}
      <div className="rounded-lg border border-app-border px-3 py-2" data-testid="date-receipt">
        <input type="hidden" name="receiptShown" value="1" />
        <label className="flex items-center gap-2 text-sm text-app-text-primary">
          <input type="checkbox" name="expectsReceipt" defaultChecked={!!existing?.expectsReceipt} className="h-4 w-4 accent-gold" />
          {t("form.receiptCheckbox")}
        </label>
        <input
          type="text"
          name="expectedFrom"
          dir="auto"
          defaultValue={existing?.expectedFrom ?? ""}
          placeholder={t("form.receiptFromPlaceholder")}
          className="mt-2 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
        <p className="mt-1 text-[11px] text-app-text-tertiary">{t("form.receiptHint")}</p>
      </div>

      <details className="rounded-lg border border-app-border px-3 py-2" open={Boolean(existing?.conditionText || existing?.rangeStart || existing?.rangeEnd)}>
        <summary className="cursor-pointer text-xs font-medium text-app-text-secondary">{t("form.conditionSection")}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-app-text-secondary">{t("form.conditionLabel")}</label>
            <input
              type="text"
              name="conditionText"
              dir="auto"
              defaultValue={existing?.conditionText ?? ""}
              placeholder={t("form.conditionPlaceholder")}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
            <p className="mt-1 text-[11px] text-app-text-tertiary">{t("form.conditionHint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-app-text-secondary">{t("form.rangeStart")}</label>
              <input type="date" name="rangeStart" defaultValue={toDateInputValue(existing?.rangeStart ?? null)} className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold" />
            </div>
            <div>
              <label className="block text-xs font-medium text-app-text-secondary">{t("form.rangeEnd")}</label>
              <input type="date" name="rangeEnd" defaultValue={toDateInputValue(existing?.rangeEnd ?? null)} className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold" />
            </div>
          </div>
        </div>
      </details>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.businessCalendar")}</label>
          {existing?.calendarLockedBy ? (
            <>
              <input type="hidden" name="businessCalendar" value={existing.businessCalendar} />
              <p className="mt-1.5 text-sm text-app-text-primary" data-testid="calendar-locked">{existing.calendarLockedBy}</p>
            </>
          ) : (
            <select name="businessCalendar" defaultValue={existing?.businessCalendar ?? "IL"} className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold">
              <option value="IL">{t("businessCalendar.IL")}</option>
              <option value="US">{t("businessCalendar.US")}</option>
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-app-text-secondary">{t("form.rollConvention")}</label>
          <select name="rollConvention" defaultValue={existing?.rollConvention ?? "NONE"} className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold">
            {(["NONE", "PREVIOUS_BUSINESS_DAY", "NEXT_BUSINESS_DAY"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`form.rollOptions.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("form.responsible")}</label>
        <select
          name="responsibleUserId"
          required
          defaultValue={existing?.responsibleUserId}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="">{t("form.chooseResponsible")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id} dir="auto">
              {u.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("form.sensitivity")}</label>
        <select
          name="sensitivity"
          defaultValue={existing?.sensitivity ?? ""}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        >
          <option value="">{t("form.sensitivityDefault")}</option>
          <option value="NORMAL">{t("form.sensitivityNormal")}</option>
          <option value="SENSITIVE">{t("form.sensitivitySensitive")}</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-app-text-secondary">{t("form.notes")}</label>
        <textarea
          name="notes"
          dir="auto"
          rows={2}
          defaultValue={existing?.notes ?? ""}
          placeholder={t("form.notesPlaceholder")}
          className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="createAutoTask"
          name="createAutoTask"
          checked={createAutoTask}
          onChange={(e) => setCreateAutoTask(e.target.checked)}
          className="h-4 w-4 rounded border-app-border"
        />
        <label htmlFor="createAutoTask" className="text-sm text-app-text-primary">
          {t("form.createAutoTask")}
        </label>
      </div>

      {createAutoTask && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-app-text-secondary">{t("form.leadDays")}</label>
            <div className="mt-1.5 flex gap-2">
              <input
                type="number"
                name="autoTaskLeadDays"
                min={0}
                defaultValue={existing?.autoTaskLeadDays ?? 7}
                className="w-20 rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
              />
              <select
                name="leadUnit"
                aria-label={t("form.leadUnit")}
                defaultValue={existing?.leadUnit ?? "CALENDAR_DAYS"}
                className="flex-1 rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
              >
                <option value="CALENDAR_DAYS">{t("form.leadUnitCalendar")}</option>
                <option value="BUSINESS_DAYS">{t("form.leadUnitBusiness")}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-app-text-secondary">{t("form.autoTaskCategory")}</label>
            <select
              name="autoTaskCategoryId"
              defaultValue={existing?.autoTaskCategoryId ?? ""}
              className="mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            >
              <option value="">{t("form.noCategory")}</option>
              {availableAutoTaskCategories.map((c) => (
                <option key={c.id} value={c.id} dir="auto">
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!isEdit && (
        <div className="flex items-center gap-2">
          <input type="checkbox" id="useDefaultReminders" name="useDefaultReminders" defaultChecked className="h-4 w-4 rounded border-app-border" />
          <label htmlFor="useDefaultReminders" className="text-sm text-app-text-primary">
            {t("form.defaultReminders")}
          </label>
        </div>
      )}

      {error && <p className="text-sm text-app-error">{error}</p>}
      <SubmitButton
        label={isEdit ? t("form.save") : t("form.create")}
        pendingLabel={isEdit ? t("form.saving") : t("form.creating")}
        pending={pending}
      />
    </form>
  );
}

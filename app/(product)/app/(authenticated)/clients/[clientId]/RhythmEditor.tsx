"use client";

// The rhythm editor (13.11.2026, processes redesign, stage 1). Built to the
// "מסך 3: מתי התהליך רץ" board (ops-runbooks/processes-redesign-design/
// Rhythm.dc.html in claude-backup): what starts the process, with nothing
// chosen in advance; for a schedule, how often and on which days; and on
// the side, the sentence and the next five dates as they will be.

import { useEffect, useMemo, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useDrawerClose } from "@/components/app/Drawer";
import { useToast } from "@/components/app/toast/ToastProvider";
import { Field, INPUT } from "./knowledge-ui";
import { previewProcessRhythmAction, saveProcessRhythmAction } from "../process-actions";
import {
  describeLegacyDates,
  describeRule,
  emptyRule,
  FREQUENCIES,
  LAST_DAY,
  readRule,
  rhythmError,
  ROLLS,
  START_KINDS,
  type Frequency,
  type LegacyDate,
  type RhythmIssue,
  type ScheduleRule,
  type StartInput,
  type StartKind,
  type StoredStart,
} from "@/lib/process-rhythm";

type Tx = (key: string, values?: Record<string, string | number>) => string;
type PreviewRow = { date: string; opens: string; movedFrom: string | null };

export type RhythmEditorProps = {
  clientId: string;
  processId: string;
  starts: (StoredStart & { legacy?: boolean })[];
  dates: LegacyDate[];
};

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const DAYS = Array.from({ length: 30 }, (_, i) => i + 1);

/// The editor's state of one start, before it is a StartInput.
type Draft = {
  kinds: StartKind[];
  rule: ScheduleRule | null;
  /// A schedule linked before stage 1, kept as it is until a frequency is chosen.
  legacy: boolean;
  event: string;
  checkEveryDays: string;
  checkText: string;
  where: string;
  when: string;
  recipient: string;
};

function draftFrom(starts: RhythmEditorProps["starts"]): Draft {
  const of = (k: StartKind) => starts.find((s) => s.kind === k);
  const schedule = of("SCHEDULE");
  return {
    kinds: START_KINDS.filter((k) => !!of(k)),
    rule: schedule ? readRule(schedule.schedule) : null,
    legacy: !!schedule && !readRule(schedule.schedule),
    event: of("EVENT")?.description ?? "",
    checkEveryDays: of("CONTINUOUS")?.checkEveryDays?.toString() ?? "",
    checkText: of("CONTINUOUS")?.checkText ?? "",
    where: of("EXTERNAL")?.externalWhere ?? "",
    when: of("EXTERNAL")?.externalWhen ?? "",
    recipient: of("EXTERNAL")?.externalRecipient ?? "",
  };
}

function inputsOf(d: Draft): StartInput[] {
  return d.kinds.map((kind): StartInput => {
    switch (kind) {
      case "SCHEDULE":
        return { kind, schedule: d.rule ?? (d.legacy ? null : emptyRule("MONTHLY")) };
      case "EVENT":
        return { kind, description: d.event };
      case "ON_DEMAND":
        return { kind };
      case "CONTINUOUS":
        return { kind, checkEveryDays: d.checkEveryDays.trim() ? Number(d.checkEveryDays) : null, checkText: d.checkText || null };
      case "EXTERNAL":
        return { kind, where: d.where, when: d.when, recipient: d.recipient || null };
    }
  });
}

const chip = (on: boolean) =>
  `min-h-[40px] rounded-full px-4 text-sm ${on ? "bg-app-surface-nav font-semibold text-white" : "border border-app-border bg-white text-app-text-primary hover:border-app-border-strong"}`;

export function RhythmEditor({ clientId, processId, starts, dates }: RhythmEditorProps) {
  const t = useTranslations("clients.processes.rhythm") as unknown as Tx;
  const locale = useLocale();
  const lang = locale.startsWith("en") ? "en" : "he";
  const format = useFormatter();
  const close = useDrawerClose();
  const { showToast } = useToast();
  const [d, setD] = useState<Draft>(() => draftFrom(starts));
  const [shown, setShown] = useState<{ period: boolean; condition: boolean }>(() => ({ period: !!(d.rule?.rangeStart || d.rule?.rangeEnd), condition: !!d.rule?.condition }));
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; stepsLead: number } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [problem, setProblem] = useState<RhythmIssue | null>(null);
  const [pending, setPending] = useState(false);

  const set = (patch: Partial<Draft>) => {
    setProblem(null);
    setD((x) => ({ ...x, ...patch }));
  };
  const setRule = (patch: Partial<ScheduleRule>) => set({ rule: d.rule ? { ...d.rule, ...patch } : null });
  const toggleKind = (k: StartKind) => set({ kinds: d.kinds.includes(k) ? d.kinds.filter((x) => x !== k) : START_KINDS.filter((x) => x === k || d.kinds.includes(x)) });
  const pickFrequency = (f: Frequency) => set({ rule: { ...emptyRule(f), leadBusinessDays: d.rule?.leadBusinessDays ?? null, rangeStart: d.rule?.rangeStart ?? null, rangeEnd: d.rule?.rangeEnd ?? null, condition: d.rule?.condition ?? null }, legacy: false });
  const toggleIn = (xs: number[], x: number) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x].sort((a, b) => a - b));

  // The next dates, from the server, whenever the rule changes.
  const ruleKey = JSON.stringify(d.kinds.includes("SCHEDULE") ? d.rule : null);
  useEffect(() => {
    const rule = d.kinds.includes("SCHEDULE") ? d.rule : null;
    let live = true;
    const timer = setTimeout(async () => {
      setPreviewError(null);
      if (!rule) {
        setPreview(null);
        return;
      }
      const r = await previewProcessRhythmAction(processId, rule);
      if (!live) return;
      if (r.error) {
        setPreview(null);
        setPreviewError(r.error);
      } else setPreview({ rows: r.rows ?? [], stepsLead: r.stepsLead ?? 0 });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ruleKey is the rule
  }, [ruleKey, processId]);

  const sentence = useMemo(() => {
    const parts: string[] = [];
    for (const k of d.kinds) {
      if (k === "SCHEDULE") parts.push(d.rule ? describeRule(d.rule, lang) : d.legacy ? describeLegacyDates(dates, lang) : t("pickHowOften"));
      if (k === "EXTERNAL") parts.push(t("sentence.external", { where: d.where || "...", when: d.when || "..." }));
      if (k === "EVENT") parts.push(t("sentence.event", { what: d.event || "..." }));
      if (k === "CONTINUOUS") parts.push(t("sentence.continuous", { days: d.checkEveryDays || "..." }));
      if (k === "ON_DEMAND") parts.push(t("sentence.onDemand"));
    }
    return parts.join(" ");
  }, [d, dates, lang, t]);

  const day = (key: string) => format.dateTime(new Date(`${key}T12:00:00Z`), { weekday: "long", day: "numeric", month: "numeric" });
  const shortDay = (key: string) => format.dateTime(new Date(`${key}T12:00:00Z`), { day: "numeric", month: "numeric" });
  const weekdayOf = (key: string) => format.dateTime(new Date(`${key}T12:00:00Z`), { weekday: "long" });

  async function save() {
    const inputs = inputsOf(d);
    const issue = d.kinds.includes("SCHEDULE") && !d.rule && !d.legacy ? { code: "pickFrequency", message: "" } : rhythmError(inputs);
    if (issue) {
      setProblem(issue);
      return;
    }
    setPending(true);
    const r = await saveProcessRhythmAction(clientId, processId, { starts: inputs });
    setPending(false);
    if (r.error) {
      showToast({ tone: "error", title: t("saveFailed"), description: r.error });
      return;
    }
    showToast({ tone: "success", title: t("saved") });
    close?.();
  }

  const rule = d.rule;
  const lead = rule?.leadBusinessDays ?? null;
  const stepsLead = preview?.stepsLead ?? 0;

  return (
    <div className="flex flex-col gap-6" data-testid="rhythm-editor">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-2.5">
            <p className="text-sm font-semibold text-app-text-primary">
              {t("startsTitle")} <span className="font-normal text-app-text-secondary">{t("startsHint")}</span>
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {START_KINDS.map((k) => {
                const on = d.kinds.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleKind(k)}
                    className={`flex min-h-[64px] flex-col items-start gap-1 rounded-xl p-3 text-start ${on ? "border-2 border-app-surface-nav bg-app-surface-sunken" : "border border-app-border bg-white hover:border-app-border-strong"}`}
                    data-testid={`rhythm-kind-${k}`}
                  >
                    <span className="text-sm font-semibold text-app-text-primary">{t(`kinds.${k}.title`)}</span>
                    <span className="text-xs text-app-text-secondary">{t(`kinds.${k}.hint`)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {d.kinds.includes("SCHEDULE") && (
            <section className="flex flex-col gap-5" data-testid="rhythm-schedule">
              {d.legacy && !rule && (
                <p className="rounded-lg bg-app-warning-soft px-3 py-2 text-xs text-app-text-primary" data-testid="rhythm-legacy">
                  {t("legacy", { sentence: describeLegacyDates(dates, lang) })}
                </p>
              )}
              <div className="flex flex-col gap-2.5">
                <p className="text-sm font-semibold text-app-text-primary">{t("howOften")}</p>
                <div className="flex flex-wrap gap-2">
                  {FREQUENCIES.map((f) => (
                    <button key={f} type="button" aria-pressed={rule?.frequency === f} onClick={() => pickFrequency(f)} className={chip(rule?.frequency === f)} data-testid={`rhythm-frequency-${f}`}>
                      {t(`frequencies.${f}`)}
                    </button>
                  ))}
                </div>
              </div>

              {rule?.frequency === "WEEKLY" && (
                <div className="flex flex-col gap-2.5">
                  <p className="text-sm font-semibold text-app-text-primary">
                    {t("weekdays")} <span className="font-normal text-app-text-secondary">{t("severalHint")}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((w) => (
                      <button key={w} type="button" aria-pressed={rule.weekdays.includes(w)} onClick={() => setRule({ weekdays: toggleIn(rule.weekdays, w) })} className={chip(rule.weekdays.includes(w))}>
                        {t(`weekdayNames.d${w}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(rule?.frequency === "MONTHLY" || rule?.frequency === "QUARTERLY") && (
                <div className="flex flex-col gap-2.5">
                  {rule.frequency === "QUARTERLY" && (
                    <Field label={t("quarterMonth")}>
                      <select value={rule.quarterMonth} onChange={(e) => setRule({ quarterMonth: Number(e.target.value) })} className={INPUT}>
                        {[1, 2, 3].map((m) => (
                          <option key={m} value={m}>
                            {t(`quarterMonths.m${m}`)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <p className="text-sm font-semibold text-app-text-primary">
                    {t("monthDays")} <span className="font-normal text-app-text-secondary">{t("severalHint")}</span>
                  </p>
                  <div className="grid max-w-[620px] grid-cols-7 gap-1.5 sm:grid-cols-11" role="group" aria-label={t("monthDays")}>
                    {DAYS.map((n) => {
                      const on = rule.monthDays.includes(n);
                      return (
                        <button key={n} type="button" aria-pressed={on} onClick={() => setRule({ monthDays: toggleIn(rule.monthDays, n) })} className={`h-11 rounded-lg text-sm ${on ? "bg-app-surface-nav font-semibold text-white" : "border border-app-border bg-white text-app-text-primary"}`} data-testid={`rhythm-day-${n}`}>
                          {n}
                        </button>
                      );
                    })}
                    <button type="button" aria-pressed={rule.monthDays.includes(LAST_DAY)} onClick={() => setRule({ monthDays: toggleIn(rule.monthDays, LAST_DAY) })} className={`col-span-2 h-11 rounded-lg text-sm ${rule.monthDays.includes(LAST_DAY) ? "bg-app-surface-nav font-semibold text-white" : "border border-app-border bg-white text-app-text-primary"}`} data-testid="rhythm-day-last">
                      {t("lastDay")}
                    </button>
                  </div>
                </div>
              )}

              {rule?.frequency === "YEARLY" && (
                <div className="flex flex-col gap-2.5">
                  <p className="text-sm font-semibold text-app-text-primary">{t("yearDates")}</p>
                  {rule.yearDates.map((yd, i) => (
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <Field label={t("month")}>
                        <select value={yd.month} onChange={(e) => setRule({ yearDates: rule.yearDates.map((x, j) => (j === i ? { ...x, month: Number(e.target.value) } : x)) })} className={INPUT}>
                          {Array.from({ length: 12 }, (_, m) => (
                            <option key={m + 1} value={m + 1}>
                              {format.dateTime(new Date(Date.UTC(2026, m, 15)), { month: "long" })}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t("day")}>
                        <input type="number" min={1} max={31} value={yd.day} onChange={(e) => setRule({ yearDates: rule.yearDates.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)) })} className={INPUT} />
                      </Field>
                      <button type="button" onClick={() => setRule({ yearDates: rule.yearDates.filter((_, j) => j !== i) })} className="min-h-[44px] text-sm text-app-text-secondary hover:text-app-error">
                        {t("removeDate")}
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setRule({ yearDates: [...rule.yearDates, { month: 1, day: 1 }] })} className="self-start text-sm font-medium text-app-text-accent hover:underline">
                    {t("addYearDate")}
                  </button>
                </div>
              )}

              {rule?.frequency === "ONCE" && (
                <Field label={t("onceDate")}>
                  <input type="date" value={rule.onceDate ?? ""} onChange={(e) => setRule({ onceDate: e.target.value || null })} className={INPUT} />
                </Field>
              )}

              {rule && (
                <div className="grid max-w-md gap-4">
                  {rule.frequency !== "BUSINESS_DAILY" && rule.frequency !== "DAILY" && (
                    <Field label={t("rollLabel")}>
                      <select value={rule.roll} onChange={(e) => setRule({ roll: e.target.value as ScheduleRule["roll"] })} className={INPUT}>
                        {ROLLS.map((r) => (
                          <option key={r} value={r}>
                            {t(`rolls.${r}`)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field label={t("leadLabel")}>
                    <select value={lead === null ? "" : String(lead)} onChange={(e) => setRule({ leadBusinessDays: e.target.value === "" ? null : Number(e.target.value) })} className={INPUT}>
                      <option value="">{stepsLead > 0 ? t("leadBySteps", { days: stepsLead }) : t("leadOnDay")}</option>
                      {Array.from({ length: 10 }, (_, i) => stepsLead + 1 + i).map((n) => (
                        <option key={n} value={n}>
                          {t("leadEarlier", { days: n })}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}

              {rule && (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-app-text-secondary">
                    {t("calendarLine")}{" "}
                    {!shown.period && (
                      <button type="button" onClick={() => setShown((s) => ({ ...s, period: true }))} className="font-medium text-app-text-accent hover:underline">
                        {t("periodLink")}
                      </button>
                    )}
                    {!shown.period && !shown.condition && " · "}
                    {!shown.condition && (
                      <button type="button" onClick={() => setShown((s) => ({ ...s, condition: true }))} className="font-medium text-app-text-accent hover:underline">
                        {t("conditionLink")}
                      </button>
                    )}
                  </p>
                  {shown.period && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={t("rangeStart")}>
                        <input type="date" value={rule.rangeStart ?? ""} onChange={(e) => setRule({ rangeStart: e.target.value || null })} className={INPUT} />
                      </Field>
                      <Field label={t("rangeEnd")}>
                        <input type="date" value={rule.rangeEnd ?? ""} onChange={(e) => setRule({ rangeEnd: e.target.value || null })} className={INPUT} />
                      </Field>
                    </div>
                  )}
                  {shown.condition && (
                    <Field label={t("condition")}>
                      <input value={rule.condition ?? ""} onChange={(e) => setRule({ condition: e.target.value || null })} placeholder={t("conditionPlaceholder")} className={INPUT} />
                    </Field>
                  )}
                </div>
              )}
            </section>
          )}

          {d.kinds.includes("EXTERNAL") && (
            <section className="flex flex-col gap-3" data-testid="rhythm-external">
              <p className="text-sm font-semibold text-app-text-primary">{t("kinds.EXTERNAL.title")}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("externalWhere")}>
                  <input value={d.where} onChange={(e) => set({ where: e.target.value })} placeholder={t("externalWherePlaceholder")} className={INPUT} />
                </Field>
                <Field label={t("externalWhen")}>
                  <input value={d.when} onChange={(e) => set({ when: e.target.value })} placeholder={t("externalWhenPlaceholder")} className={INPUT} />
                </Field>
              </div>
              <Field label={t("externalRecipient")}>
                <input value={d.recipient} onChange={(e) => set({ recipient: e.target.value })} className={INPUT} />
              </Field>
            </section>
          )}

          {d.kinds.includes("EVENT") && (
            <section className="flex flex-col gap-3" data-testid="rhythm-event">
              <Field label={t("eventLabel")}>
                <textarea value={d.event} onChange={(e) => set({ event: e.target.value })} rows={2} placeholder={t("eventPlaceholder")} className={INPUT} />
              </Field>
            </section>
          )}

          {d.kinds.includes("CONTINUOUS") && (
            <section className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]" data-testid="rhythm-continuous">
              <Field label={t("checkEvery")}>
                <input value={d.checkEveryDays} onChange={(e) => set({ checkEveryDays: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="7" className={INPUT} />
              </Field>
              <Field label={t("checkText")}>
                <input value={d.checkText} onChange={(e) => set({ checkText: e.target.value })} className={INPUT} />
              </Field>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4 rounded-xl bg-app-surface-sunken p-5" aria-live="polite" data-testid="rhythm-preview">
          <p className="text-xs font-semibold text-app-text-secondary">{t("previewTitle")}</p>
          <p className="text-base font-bold leading-snug text-app-text-primary" data-testid="rhythm-sentence">
            {d.kinds.length ? sentence : t("nothingChosen")}
          </p>
          {preview && preview.rows.length > 0 && (
            <ul className="flex flex-col gap-2">
              {preview.rows.map((r) => (
                <li key={r.date} className="flex flex-col gap-0.5 rounded-lg bg-white px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold text-app-text-primary">{day(r.date)}</span>
                    {r.opens !== r.date && <span className="text-xs text-app-text-secondary"> · {t("opens", { date: shortDay(r.opens) })}</span>}
                  </span>
                  {r.movedFrom && <span className="text-xs text-app-warning">{t("movedFrom", { weekday: weekdayOf(r.movedFrom) })}</span>}
                </li>
              ))}
            </ul>
          )}
          {preview && preview.rows.length === 0 && <p className="text-xs text-app-text-secondary">{t("noDates")}</p>}
          {previewError && <p className="text-xs text-app-error">{previewError}</p>}
          <p className="text-xs leading-relaxed text-app-text-secondary">{t("previewNote")}</p>
        </aside>
      </div>

      {problem && (
        <p className="text-sm text-app-error" role="alert" data-testid="rhythm-problem">
          {t(`errors.${problem.code}`, problem.params ?? {})}
        </p>
      )}
      <div className="flex flex-wrap gap-3 border-t border-app-border pt-4">
        <button type="button" onClick={save} disabled={pending} className="min-h-[46px] rounded-xl bg-app-surface-nav px-6 text-sm font-bold text-white disabled:opacity-50" data-testid="rhythm-save">
          {pending ? t("saving") : t("save")}
        </button>
        <button type="button" onClick={() => close?.()} className="min-h-[46px] rounded-xl border border-app-border-strong bg-white px-5 text-sm text-app-text-primary">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

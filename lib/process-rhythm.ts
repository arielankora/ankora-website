// The rhythm of a process: what starts it, and the sentence that says so
// (13.11.2026, processes redesign, stage 1; ops-runbooks/processes-
// redesign-spec-2026-11-13.md in claude-backup, 4.2 and 5.3).
//
// One rhythm replaces three things that did not talk to each other: the
// trigger kinds (check boxes), the trigger in words, and the dates linked
// from elsewhere. A process has one or more starts. A schedule start holds
// the rule the editor wrote, and its dates are generated from that rule, so
// the sentence and the dates can never say different things (Autenik P1
// read "on the 1st of the month" and opened a run every day).
//
// Pure: the editor, the server and the tests read it the same way.

export const START_KINDS = ["SCHEDULE", "EXTERNAL", "EVENT", "CONTINUOUS", "ON_DEMAND"] as const;
export type StartKind = (typeof START_KINDS)[number];

export const FREQUENCIES = ["BUSINESS_DAILY", "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "ONCE"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const ROLLS = ["PREVIOUS_BUSINESS_DAY", "NEXT_BUSINESS_DAY", "NONE"] as const;
export type Roll = (typeof ROLLS)[number];

/// The last day of the month. The date engine clamps 31 to each month's
/// last day, and a roll moves it to the last business day.
export const LAST_DAY = 31;

export type ScheduleRule = {
  frequency: Frequency;
  /// WEEKLY: 0 = Sunday ... 6 = Saturday.
  weekdays: number[];
  /// MONTHLY and QUARTERLY: 1 to 31, 31 being the last day.
  monthDays: number[];
  /// QUARTERLY: which month of each quarter, 1 to 3.
  quarterMonth: number;
  /// YEARLY: each date in the year.
  yearDates: { month: number; day: number }[];
  /// ONCE: YYYY-MM-DD.
  onceDate: string | null;
  /// Where an occurrence on a weekend or a holiday moves. Not for daily.
  roll: Roll;
  /// Open the run this many business days before the date. Null: as the
  /// steps need (the earliest step's day, plus one). Never later than the
  /// steps need: the daily job takes the earlier of the two.
  leadBusinessDays: number | null;
  /// Only inside a period (YYYY-MM-DD), and only if something is true.
  rangeStart: string | null;
  rangeEnd: string | null;
  condition: string | null;
};

export type StartInput =
  /// `schedule: null` keeps a legacy schedule's dates as they are.
  | { kind: "SCHEDULE"; schedule: ScheduleRule | null }
  | { kind: "EVENT"; description: string }
  | { kind: "ON_DEMAND" }
  | { kind: "CONTINUOUS"; checkEveryDays: number | null; checkText: string | null }
  | { kind: "EXTERNAL"; where: string; when: string; recipient: string | null };

/// A start as it is stored (ProcessStart). `schedule` is the rule, or
/// `{ legacy: true }` for dates linked before stage 1, which stay as they
/// are until the rhythm is edited.
export type StoredStart = {
  kind: StartKind;
  schedule: unknown;
  description: string | null;
  checkEveryDays: number | null;
  checkText: string | null;
  externalWhere: string | null;
  externalWhen: string | null;
  externalRecipient: string | null;
};

/// One date the rule needs, in the date engine's terms (ImportantDate).
export type DateSpec = {
  recurrence: "BUSINESS_DAILY" | "DAILY" | "WEEKLY" | "MONTHLY" | "ANNUAL" | "ONCE";
  month: number;
  day: number;
  weekday: number | null;
  intervalMonths: number | null;
  onceDate: string | null;
  rollConvention: Roll;
};

/// A linked date as the sentence reads it, for a legacy schedule.
export type LegacyDate = {
  recurrence: string;
  month: number;
  day: number;
  weekday: number | null;
  intervalMonths: number | null;
  onceDate: Date | string | null;
  rollConvention: string;
};

export const MAX_CHECK_DAYS = 365;

const uniqSorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

export function emptyRule(frequency: Frequency): ScheduleRule {
  return {
    frequency,
    weekdays: [],
    monthDays: [],
    quarterMonth: 1,
    yearDates: [],
    onceDate: null,
    roll: frequency === "WEEKLY" || frequency === "BUSINESS_DAILY" || frequency === "DAILY" ? "NONE" : "PREVIOUS_BUSINESS_DAY",
    leadBusinessDays: null,
    rangeStart: null,
    rangeEnd: null,
    condition: null,
  };
}

/// The rule as stored, or null when it is not one (legacy, or broken).
export function readRule(value: unknown): ScheduleRule | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!FREQUENCIES.includes(v.frequency as Frequency)) return null;
  const nums = (x: unknown) => (Array.isArray(x) ? x.filter((n): n is number => Number.isInteger(n)) : []);
  const yearDates = Array.isArray(v.yearDates)
    ? v.yearDates
        .filter((d): d is { month: number; day: number } => !!d && typeof d === "object" && Number.isInteger((d as { month: unknown }).month) && Number.isInteger((d as { day: unknown }).day))
        .map((d) => ({ month: d.month, day: d.day }))
    : [];
  return {
    frequency: v.frequency as Frequency,
    weekdays: uniqSorted(nums(v.weekdays)),
    monthDays: uniqSorted(nums(v.monthDays)),
    quarterMonth: Number.isInteger(v.quarterMonth) ? (v.quarterMonth as number) : 1,
    yearDates,
    onceDate: typeof v.onceDate === "string" ? v.onceDate : null,
    roll: ROLLS.includes(v.roll as Roll) ? (v.roll as Roll) : "NONE",
    leadBusinessDays: Number.isInteger(v.leadBusinessDays) ? (v.leadBusinessDays as number) : null,
    rangeStart: typeof v.rangeStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.rangeStart) ? v.rangeStart : null,
    rangeEnd: typeof v.rangeEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.rangeEnd) ? v.rangeEnd : null,
    condition: typeof v.condition === "string" && v.condition.trim() ? v.condition.trim().slice(0, 500) : null,
  };
}

export function isLegacySchedule(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { legacy?: unknown }).legacy === true;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const MAX_LEAD_BUSINESS_DAYS = 20;

/// What is wrong, as a code the screen words in its language
/// (clients.processes.rhythm.errors.<code>), with the Hebrew for the server.
export type RhythmIssue = { code: string; message: string; params?: Record<string, number> };

function issue(code: string, message: string, params?: Record<string, number>): RhythmIssue {
  return params ? { code, message, params } : { code, message };
}

/// What is wrong with the rule, in Hebrew, or null.
export function ruleError(rule: ScheduleRule): RhythmIssue | null {
  if (rule.leadBusinessDays !== null && (rule.leadBusinessDays < 0 || rule.leadBusinessDays > MAX_LEAD_BUSINESS_DAYS)) return issue("leadRange", `פתיחת הריצה: עד ${MAX_LEAD_BUSINESS_DAYS} ימי עסקים לפני.`, { max: MAX_LEAD_BUSINESS_DAYS });
  if (rule.rangeStart && rule.rangeEnd && rule.rangeStart > rule.rangeEnd) return issue("rangeOrder", "סוף התקופה לפני ההתחלה שלה.");
  switch (rule.frequency) {
    case "BUSINESS_DAILY":
    case "DAILY":
      return null;
    case "WEEKLY":
      if (rule.weekdays.length === 0) return issue("noWeekday", "צריך לבחור לפחות יום אחד בשבוע.");
      if (rule.weekdays.some((d) => d < 0 || d > 6)) return issue("badWeekday", "יום בשבוע לא תקין.");
      return null;
    case "MONTHLY":
    case "QUARTERLY":
      if (rule.monthDays.length === 0) return issue("noMonthDay", "צריך לבחור לפחות יום אחד בחודש.");
      if (rule.monthDays.some((d) => d < 1 || d > 31)) return issue("badMonthDay", "יום בחודש צריך להיות בין 1 ל-31.");
      if (rule.frequency === "QUARTERLY" && (rule.quarterMonth < 1 || rule.quarterMonth > 3)) return issue("noQuarterMonth", "צריך לבחור באיזה חודש ברבעון.");
      return null;
    case "YEARLY":
      if (rule.yearDates.length === 0) return issue("noYearDate", "צריך לבחור לפחות תאריך אחד בשנה.");
      if (rule.yearDates.some((d) => d.month < 1 || d.month > 12 || d.day < 1 || d.day > DAYS_IN_MONTH[d.month - 1])) return issue("badYearDate", "תאריך בשנה לא תקין.");
      return null;
    case "ONCE":
      if (!rule.onceDate || !/^\d{4}-\d{2}-\d{2}$/.test(rule.onceDate)) return issue("noOnceDate", "צריך תאריך.");
      return null;
  }
}

/// What is wrong with a start, in Hebrew, or null.
export function startError(start: StartInput): RhythmIssue | null {
  switch (start.kind) {
    case "SCHEDULE":
      return start.schedule ? ruleError(start.schedule) : null;
    case "EVENT":
      return start.description.trim() ? null : issue("noEvent", "צריך לכתוב מה קורה שמתחיל את התהליך.");
    case "ON_DEMAND":
      return null;
    case "CONTINUOUS":
      if (start.checkEveryDays === null) return issue("noCheck", "בתהליך שוטף צריך לקבוע כל כמה ימים בודקים.");
      if (!Number.isInteger(start.checkEveryDays) || start.checkEveryDays < 1 || start.checkEveryDays > MAX_CHECK_DAYS) return issue("checkRange", `בדיקה כל 1 עד ${MAX_CHECK_DAYS} ימים.`, { max: MAX_CHECK_DAYS });
      return null;
    case "EXTERNAL":
      if (!start.where.trim()) return issue("noWhere", "צריך לכתוב איפה הוא רץ.");
      if (!start.when.trim()) return issue("noWhen", "צריך לכתוב מתי הוא רץ.");
      return null;
  }
}

/// What is wrong with the whole rhythm, or null. Each kind at most once:
/// two schedules are one schedule with more days.
export function rhythmError(starts: StartInput[]): RhythmIssue | null {
  if (starts.length === 0) return issue("noStart", "צריך לבחור לפחות דבר אחד שמתחיל את התהליך.");
  const kinds = starts.map((s) => s.kind);
  if (new Set(kinds).size !== kinds.length) return issue("duplicateKind", "כל סוג התחלה פעם אחת.");
  for (const s of starts) {
    const e = startError(s);
    if (e) return e;
  }
  return null;
}

/// The dates a rule needs. The date engine has one recurrence per date, so
/// "the 10th and the 25th" is two monthly dates, "Sunday and Wednesday" two
/// weekly ones.
export function datesForRule(rule: ScheduleRule): DateSpec[] {
  const base = { weekday: null, intervalMonths: null, onceDate: null, rollConvention: rule.roll };
  switch (rule.frequency) {
    case "BUSINESS_DAILY":
      return [{ ...base, recurrence: "BUSINESS_DAILY", month: 1, day: 1, rollConvention: "NONE" }];
    case "DAILY":
      return [{ ...base, recurrence: "DAILY", month: 1, day: 1, rollConvention: "NONE" }];
    case "WEEKLY":
      return uniqSorted(rule.weekdays).map((weekday) => ({ ...base, recurrence: "WEEKLY", month: 1, day: 1, weekday }));
    case "MONTHLY":
      return uniqSorted(rule.monthDays).map((day) => ({ ...base, recurrence: "MONTHLY", month: 1, day }));
    case "QUARTERLY":
      return uniqSorted(rule.monthDays).map((day) => ({ ...base, recurrence: "MONTHLY", month: rule.quarterMonth, day, intervalMonths: 3 }));
    case "YEARLY":
      return [...rule.yearDates]
        .sort((a, b) => a.month - b.month || a.day - b.day)
        .map((d) => ({ ...base, recurrence: "ANNUAL", month: d.month, day: d.day }));
    case "ONCE": {
      const [, m, d] = (rule.onceDate ?? "2000-01-01").split("-").map(Number);
      return [{ ...base, recurrence: "ONCE", month: m, day: d, onceDate: rule.onceDate }];
    }
  }
}

/// The trigger kinds the rhythm amounts to, for every reader of
/// Process.triggerKinds.
export function kindsOf(starts: { kind: StartKind }[]): ("SCHEDULED" | "EVENT" | "ON_DEMAND" | "CONTINUOUS" | "EXTERNAL")[] {
  const map = { SCHEDULE: "SCHEDULED", EVENT: "EVENT", ON_DEMAND: "ON_DEMAND", CONTINUOUS: "CONTINUOUS", EXTERNAL: "EXTERNAL" } as const;
  return START_KINDS.filter((k) => starts.some((s) => s.kind === k)).map((k) => map[k]);
}

// ---------------------------------------------------------------------------
// The sentence. Hebrew is what is stored (Process.triggerText, read by the
// procedure document and by Claude); the screen asks for its own language.
// ---------------------------------------------------------------------------

export type RhythmLang = "he" | "en";

const WEEKDAY_NAMES: Record<RhythmLang, string[]> = {
  he: ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

function joinList(items: string[], lang: RhythmLang): string {
  if (items.length <= 1) return items.join("");
  const last = items[items.length - 1];
  // "ו-15 במרץ" with a hyphen before a digit, "ורביעי" without.
  const and = lang === "he" ? (/^\d/.test(last) ? " ו-" : " ו") : " and ";
  return lang === "he"
    ? `${items.slice(0, -1).join(", ")}${and}${items[items.length - 1]}`
    : `${items.slice(0, -1).join(", ")}${items.length > 2 ? "," : ""}${and}${items[items.length - 1]}`;
}

function dayWord(day: number, lang: RhythmLang): string {
  if (day === LAST_DAY) return lang === "he" ? "ביום האחרון" : "on the last day";
  return lang === "he" ? `ב-${day}` : `on the ${ordinal(day)}`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

function daysPhrase(days: number[], lang: RhythmLang): string {
  const sorted = uniqSorted(days);
  if (lang === "en") return joinList(sorted.map((d) => dayWord(d, lang)), lang);
  // "ב-10 וב-25", "ב-5, ב-15 וב-25", "ב-1 וביום האחרון".
  const words = sorted.map((d) => dayWord(d, lang));
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} ו${words[words.length - 1]}`;
}

function timesWord(n: number, unit: "month" | "week" | "year" | "quarter", lang: RhythmLang): string {
  if (lang === "en") {
    const u = { month: "month", week: "week", year: "year", quarter: "quarter" }[unit];
    return n === 1 ? `once a ${u}` : n === 2 ? `twice a ${u}` : `${n} times a ${u}`;
  }
  const u = { month: "בחודש", week: "בשבוע", year: "בשנה", quarter: "ברבעון" }[unit];
  return n === 1 ? `פעם ${u}` : n === 2 ? `פעמיים ${u}` : `${n} פעמים ${u}`;
}

const MONTH_NAMES: Record<RhythmLang, string[]> = {
  he: ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

function rollPhrase(roll: Roll, lang: RhythmLang): string | null {
  if (roll === "NONE") return null;
  if (lang === "en") return roll === "PREVIOUS_BUSINESS_DAY" ? "On a weekend or holiday: the business day before." : "On a weekend or holiday: the next business day.";
  return roll === "PREVIOUS_BUSINESS_DAY" ? "בסוף שבוע או חג: יום העסקים שלפני." : "בסוף שבוע או חג: יום העסקים שאחרי.";
}

/// "פעמיים בחודש, ב-10 וב-25. בסוף שבוע או חג: יום העסקים שלפני."
export function describeRule(rule: ScheduleRule, lang: RhythmLang = "he"): string {
  const he = lang === "he";
  let main: string;
  switch (rule.frequency) {
    case "BUSINESS_DAILY":
      return withLimits(he ? "כל יום עסקים." : "Every business day.", rule, lang);
    case "DAILY":
      return withLimits(he ? "כל יום, כולל סוף שבוע וחגים." : "Every day, weekends and holidays included.", rule, lang);
    case "WEEKLY": {
      const days = uniqSorted(rule.weekdays).map((d) => WEEKDAY_NAMES[lang][d]);
      main = he ? `${timesWord(days.length, "week", lang)}, ביום ${joinList(days, lang)}` : `${timesWord(days.length, "week", lang)}, on ${joinList(days, lang)}`;
      break;
    }
    case "MONTHLY":
      main = `${timesWord(rule.monthDays.length, "month", lang)}, ${daysPhrase(rule.monthDays, lang)}`;
      break;
    case "QUARTERLY": {
      const which = he ? ["הראשון", "השני", "השלישי"][rule.quarterMonth - 1] : ["first", "second", "third"][rule.quarterMonth - 1];
      main = he
        ? `${timesWord(rule.monthDays.length, "quarter", lang)}, ${daysPhrase(rule.monthDays, lang)} בחודש ${which} של כל רבעון`
        : `${timesWord(rule.monthDays.length, "quarter", lang)}, ${daysPhrase(rule.monthDays, lang)} of the ${which} month of each quarter`;
      break;
    }
    case "YEARLY": {
      const dates = [...rule.yearDates].sort((a, b) => a.month - b.month || a.day - b.day).map((d) => (he ? `${d.day} ב${MONTH_NAMES.he[d.month - 1]}` : `${MONTH_NAMES.en[d.month - 1]} ${d.day}`));
      main = he ? `${timesWord(dates.length, "year", lang)}: ${joinList(dates, lang)}` : `${timesWord(dates.length, "year", lang)}: ${joinList(dates, lang)}`;
      break;
    }
    case "ONCE": {
      const [y, m, d] = (rule.onceDate ?? "").split("-").map(Number);
      main = he ? `פעם אחת, ב-${d}.${m}.${y}` : `Once, on ${d}.${m}.${y}`;
      break;
    }
  }
  const parts = [`${main}.`];
  const roll = rollPhrase(rule.roll, lang);
  if (roll) parts.push(roll);
  return withLimits(parts.join(" "), rule, lang);
}

function withLimits(sentence: string, rule: ScheduleRule, lang: RhythmLang): string {
  const he = lang === "he";
  const fmt = (k: string) => k.split("-").reverse().map((x) => String(Number(x))).join(".");
  const extra: string[] = [];
  if (rule.rangeStart && rule.rangeEnd) extra.push(he ? `רק מ-${fmt(rule.rangeStart)} עד ${fmt(rule.rangeEnd)}.` : `Only from ${fmt(rule.rangeStart)} to ${fmt(rule.rangeEnd)}.`);
  else if (rule.rangeStart) extra.push(he ? `החל מ-${fmt(rule.rangeStart)}.` : `Starting ${fmt(rule.rangeStart)}.`);
  else if (rule.rangeEnd) extra.push(he ? `עד ${fmt(rule.rangeEnd)}.` : `Until ${fmt(rule.rangeEnd)}.`);
  if (rule.condition) extra.push(he ? `רק אם ${rule.condition.replace(/\.$/, "")}.` : `Only if ${rule.condition.replace(/\.$/, "")}.`);
  return extra.length ? `${sentence} ${extra.join(" ")}` : sentence;
}

/// The dates of a schedule linked before stage 1, read back as best as one
/// line can: each date's own recurrence.
export function describeLegacyDates(dates: LegacyDate[], lang: RhythmLang = "he"): string {
  if (dates.length === 0) return lang === "he" ? "לפי מועד, בלי מועד מקושר." : "By date, with no date linked.";
  const parts = dates.map((d) => {
    const roll = (ROLLS as readonly string[]).includes(d.rollConvention) ? (d.rollConvention as Roll) : "NONE";
    const rule: ScheduleRule = { ...emptyRule("MONTHLY"), roll };
    switch (d.recurrence) {
      case "BUSINESS_DAILY":
        return describeRule({ ...rule, frequency: "BUSINESS_DAILY" }, lang);
      case "DAILY":
        return describeRule({ ...rule, frequency: "DAILY" }, lang);
      case "WEEKLY":
        return describeRule({ ...rule, frequency: "WEEKLY", weekdays: d.weekday === null ? [] : [d.weekday] }, lang);
      case "MONTHLY":
        return d.intervalMonths === 3
          ? describeRule({ ...rule, frequency: "QUARTERLY", monthDays: [d.day], quarterMonth: ((d.month - 1) % 3) + 1 }, lang)
          : describeRule({ ...rule, frequency: "MONTHLY", monthDays: [d.day] }, lang);
      case "ANNUAL":
        return describeRule({ ...rule, frequency: "YEARLY", yearDates: [{ month: d.month, day: d.day }] }, lang);
      case "ONCE": {
        const key = d.onceDate ? (typeof d.onceDate === "string" ? d.onceDate.slice(0, 10) : d.onceDate.toISOString().slice(0, 10)) : null;
        return describeRule({ ...rule, frequency: "ONCE", onceDate: key }, lang);
      }
      default:
        return lang === "he" ? "מועד בקצב אחר." : "A date on another rhythm.";
    }
  });
  return [...new Set(parts)].join(" ");
}

/// One start in a sentence.
export function describeStart(start: StoredStart, legacyDates: LegacyDate[] = [], lang: RhythmLang = "he"): string {
  const he = lang === "he";
  switch (start.kind) {
    case "SCHEDULE": {
      const rule = readRule(start.schedule);
      return rule ? describeRule(rule, lang) : describeLegacyDates(legacyDates, lang);
    }
    case "EVENT":
      return he ? `כשמשהו קורה: ${start.description?.trim() || "לא כתוב מה"}.`.replace(/\.\.$/, ".") : `When something happens: ${start.description?.trim() || "not written"}.`.replace(/\.\.$/, ".");
    case "ON_DEMAND":
      return he ? "כשמבקשים." : "On request.";
    case "CONTINUOUS":
      if (!start.checkEveryDays) return he ? "שוטף, בלי תדירות בדיקה." : "Ongoing, with no check frequency.";
      return he
        ? `שוטף, בדיקה כל ${start.checkEveryDays === 1 ? "יום" : start.checkEveryDays === 7 ? "שבוע" : `${start.checkEveryDays} ימים`}${start.checkText?.trim() ? `: ${start.checkText.trim()}` : ""}.`.replace(/\.\.$/, ".")
        : `Ongoing, checked every ${start.checkEveryDays === 1 ? "day" : start.checkEveryDays === 7 ? "week" : `${start.checkEveryDays} days`}${start.checkText?.trim() ? `: ${start.checkText.trim()}` : ""}.`.replace(/\.\.$/, ".");
    case "EXTERNAL": {
      const parts = [start.externalWhere?.trim(), start.externalWhen?.trim()].filter(Boolean).join(", ");
      const to = start.externalRecipient?.trim();
      return he
        ? `רץ אוטומטית מחוץ לאפליקציה${parts ? `: ${parts}` : ""}${to ? `. התוצאה אל ${to}` : ""}.`
        : `Runs by itself outside the app${parts ? `: ${parts}` : ""}${to ? `. The result goes to ${to}` : ""}.`;
    }
  }
}

/// The whole rhythm in one paragraph, starts in a fixed order.
export function describeRhythm(starts: StoredStart[], legacyDates: LegacyDate[] = [], lang: RhythmLang = "he"): string {
  const order = (k: StartKind) => START_KINDS.indexOf(k);
  return [...starts]
    .sort((a, b) => order(a.kind) - order(b.kind))
    .map((s) => describeStart(s, s.kind === "SCHEDULE" ? legacyDates : [], lang))
    .join(" ");
}

/// A start as the editor sends it, read from untrusted JSON. Null when it
/// is not one.
export function readStartInput(value: unknown): StartInput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === "string" ? x.trim().slice(0, 1000) : "");
  switch (v.kind) {
    case "SCHEDULE": {
      if (v.schedule === null) return { kind: "SCHEDULE", schedule: null };
      const rule = readRule(v.schedule);
      return rule ? { kind: "SCHEDULE", schedule: rule } : null;
    }
    case "EVENT":
      return { kind: "EVENT", description: text(v.description) };
    case "ON_DEMAND":
      return { kind: "ON_DEMAND" };
    case "CONTINUOUS": {
      const n = typeof v.checkEveryDays === "number" ? v.checkEveryDays : typeof v.checkEveryDays === "string" && v.checkEveryDays.trim() ? Number(v.checkEveryDays) : null;
      return { kind: "CONTINUOUS", checkEveryDays: n === null || Number.isNaN(n) ? null : n, checkText: text(v.checkText) || null };
    }
    case "EXTERNAL":
      return { kind: "EXTERNAL", where: text(v.where), when: text(v.when), recipient: text(v.recipient) || null };
    default:
      return null;
  }
}

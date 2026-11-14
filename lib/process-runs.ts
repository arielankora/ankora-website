// A run of a process: when it opens, when each step is due, and what the
// task says (claude/org-brain-spec-2026-10-12.md, 5.3). Pure: the job,
// the "start a run" button and the tests compute it the same way.

import { shiftBusinessDays, type BusinessCalendarKey } from "@/lib/business-calendar";
import { ACTION_TAG_LABELS, FIELD_LABELS, STEP_MODE_LABELS, type ProcessStep } from "@/lib/process-rules";

const FIELD_LABELS_HE: Record<string, string> = FIELD_LABELS;

/// Business days before the date that the run has to open, so that the
/// earliest step is not already late when it does: a step at -2 needs
/// the run open on -3.
export function runLeadBusinessDays(steps: ProcessStep[]): number {
  const earliest = Math.min(0, ...steps.map((s) => s.offsetBusinessDays ?? 0));
  return earliest < 0 ? -earliest + 1 : 0;
}

/// The due day of each step, as a date key (YYYY-MM-DD), counted in the
/// date's business calendar from the run's day. A step without an offset
/// is due on the day itself.
export function stepDueKeys(runKey: string, steps: ProcessStep[], calendar: BusinessCalendarKey): string[] {
  return steps.map((s) => shiftBusinessDays(runKey, s.offsetBusinessDays ?? 0, calendar));
}

/// A step's title in the run: the step's own words. How it is done and who
/// approves it are on the step (stepMode, supervisorId, approvalContactId)
/// and the screen says them in its reader's language (14.11.2026; before,
/// they were written into the title in Hebrew).
export function stepTitle(step: ProcessStep): string {
  return step.title.slice(0, 200);
}

/// What a run's task shows about its procedure (14.11.2026), as data: the
/// screen renders it in the reader's language, and runDescription below
/// writes it as text for Claude. Frozen when the run opens, like the
/// version it follows.
export type RunBrief = {
  v: 1;
  code: string;
  title: string;
  version: number;
  purpose: string | null;
  doNotDisclose: string | null;
  /// `approver`: who approves the step, by name, when it asks for one.
  steps: { title: string; mode: ProcessStep["mode"]; actionTags: ProcessStep["actionTags"]; systems: string[]; output: string | null; verification: string | null; approver?: string | null }[];
  highlights: string | null;
  outputs: string | null;
  /// The client's rules that apply, each as its title and what it says
  /// (client data, in the file's words).
  rules: { title: string; text: string; proposed: boolean; startsOn: string | null; proposedRule: string | null }[];
  exceptions: { policy: string; what: string; until: string }[];
  gaps: { missing: string[]; noAccess: string[] };
  review: "RULES" | "PERIODIC" | null;
  exceptionPlaybook: string | null;
};

export function readRunBrief(value: unknown): RunBrief | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<RunBrief>;
  if (v.v !== 1 || typeof v.code !== "string" || !Array.isArray(v.steps)) return null;
  return v as RunBrief;
}

/// The brief as Hebrew text, for Claude (get_task, "קדם עם קלוד").
export function runBriefText(b: RunBrief): string {
  const rule = (r: RunBrief["rules"][number]) =>
    r.proposedRule
      ? `${r.title}: עד שהכלל יאושר, ${r.text} (הכלל המוצע: ${r.proposedRule})`
      : `${r.title}: ${r.startsOn ? `מ-${r.startsOn.split("-").reverse().join(".")}, ` : ""}${r.text}${r.proposed ? " (מוצע, עוד לא אושר)" : ""}`;
  const gaps = [
    ...(b.review ? [`הנוהל דורש סקירה: ${b.review === "RULES" ? "הנוהל שבתוקף לא עומד בכללי הלקוח" : "הגיע מועד הסקירה התקופתית"}. לבדוק מול כללי הלקוח בתיק לפני שמבצעים.`] : []),
    ...b.gaps.missing.map((k) => `חסר: ${FIELD_LABELS_HE[k] ?? k}`),
    ...(b.gaps.noAccess.length ? [`אין לנו גישה ל: ${b.gaps.noAccess.join(", ")}`] : []),
  ];
  return runDescription({
    code: b.code,
    title: b.title,
    version: b.version,
    purpose: b.purpose,
    doNotDisclose: b.doNotDisclose,
    steps: b.steps.map((s) => ({ ...s, title: s.approver ? `${s.title}, דורש אישור של ${s.approver}` : s.title, systemIds: s.systems }) as unknown as ProcessStep),
    highlights: b.highlights,
    outputs: b.outputs,
    gaps,
    rules: b.rules.map(rule),
    exceptions: b.exceptions.map((e) => `${e.policy}: ${e.what}, עד ${e.until.split("-").reverse().join(".")}`),
    exceptionPlaybook: b.exceptionPlaybook,
    systemName: (name) => name,
  });
}

export type RunDescriptionInput = {
  code: string;
  title: string;
  version: number;
  purpose: string | null;
  /// Spec 6.1: who must not be told what, read before anything else.
  doNotDisclose?: string | null;
  steps: ProcessStep[];
  highlights: string | null;
  outputs: string | null;
  gaps: string[];
  rules: string[];
  exceptions: string[];
  exceptionPlaybook: string | null;
  systemName: (id: string) => string;
};

/// What the person opening the run reads first: which procedure, why it
/// exists, what matters, what is missing, which of the client's rules
/// apply, and what to do when something deviates. Plain Markdown.
export function runDescription(r: RunDescriptionInput): string {
  const out: string[] = [`**ריצה של ${r.code} ${r.title}, לפי נוהל גרסה ${r.version}.**`];
  if (r.purpose) out.push("", `למה: ${r.purpose}`);
  if (r.doNotDisclose?.trim()) out.push("", `**לא לספר:** ${r.doNotDisclose.trim()}`);
  out.push("", "**השלבים**");
  r.steps.forEach((s, i) => {
    const details = [
      STEP_MODE_LABELS[s.mode],
      s.actionTags.length ? s.actionTags.map((t) => ACTION_TAG_LABELS[t]).join(", ") : null,
      s.systemIds.length ? s.systemIds.map(r.systemName).join(", ") : null,
      s.output ? `תוצר: ${s.output}` : null,
      s.verification ? `אימות: ${s.verification}` : null,
    ].filter(Boolean);
    out.push(`${i + 1}. ${s.title} (${details.join(" · ")})`);
  });
  if (r.highlights) out.push("", `**דגשים:** ${r.highlights}`);
  if (r.outputs) out.push("", `**הריצה גמורה כשיש:** ${r.outputs}`);
  if (r.rules.length) out.push("", "**כללי הלקוח שחלים**", ...r.rules.map((x) => `- ${x}`));
  if (r.exceptions.length) out.push("", "**חריגות מאושרות**", ...r.exceptions.map((x) => `- ${x}`));
  if (r.gaps.length) out.push("", "**פערים בתהליך**", ...r.gaps.map((x) => `- ${x}`));
  if (r.exceptionPlaybook) out.push("", `**כשמשהו חורג:** ${r.exceptionPlaybook}`);
  return out.join("\n");
}

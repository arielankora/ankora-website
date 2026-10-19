// A run of a process: when it opens, when each step is due, and what the
// task says (claude/org-brain-spec-2026-10-12.md, 5.3). Pure: the job,
// the "start a run" button and the tests compute it the same way.

import { shiftBusinessDays, type BusinessCalendarKey } from "@/lib/business-calendar";
import { ACTION_TAG_LABELS, STEP_MODE_LABELS, type ProcessStep } from "@/lib/process-rules";

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

/// A step's title in the run: the step, and when it is not plain manual
/// work, how it is done; when it needs approval, by whom.
export function stepTitle(step: ProcessStep, approver: string | null): string {
  const parts = [step.title];
  if (step.mode !== "MANUAL") parts.push(`(${STEP_MODE_LABELS[step.mode]})`);
  if (step.requiresApproval) parts.push(`, דורש אישור${approver ? ` של ${approver}` : ""}`);
  return parts.join(" ").replace(" ,", ",").slice(0, 200);
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

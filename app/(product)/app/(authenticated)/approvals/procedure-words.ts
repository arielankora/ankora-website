import { holdsBack, type PreviewCheck } from "@/lib/approvals-preview";
import { formatAmount } from "@/lib/policy-params";
import { mergeStepChecks, type ProcessStep } from "@/lib/process-rules";
import type { StepText } from "@/lib/next-steps";

// ADR 0006: the approvals screen's words for what lib builds in Hebrew for
// Claude and the client file: a procedure's step lines and the checks that
// hold it back (lib/approvals-preview.ts), and a process decision's lines
// (lib/next-steps.ts). The screen is a server component, so these take a
// translator rather than calling a hook.

/// A translator whose keys are built at runtime (a label by its enum
/// value, a check by its key), for "clients.processes" and
/// "approvals.preview". tests/unit/knowledge-flag-words.test.ts holds the
/// Hebrew they give to lib's.
export type LooseT = (key: string, values?: Record<string, string | number>) => string;

/// A line lib/next-steps gives as a key, in the reader's language; the
/// same reading as the process panel's (ProcessesPanel.tsx).
export function stepTextWords(tProc: LooseT, x: StepText | undefined | null, fallback: string): string {
  if (!x) return fallback;
  if ("raw" in x) return x.raw;
  const refs = Object.fromEntries(Object.entries(x.refs ?? {}).map(([k, key]) => [k, tProc(key)]));
  return tProc(x.key, { ...x.values, ...refs });
}

/// One step, as stepLine in lib/approvals-preview.ts writes it in Hebrew.
function stepWords(tProc: LooseT, tPrev: LooseT, st: ProcessStep, i: number, systemName: Record<string, string>): string {
  const parts = [
    tProc(`labels.stepModes.${st.mode}`),
    st.offsetBusinessDays !== null ? tPrev("step.businessDays", { days: st.offsetBusinessDays >= 0 ? `+${st.offsetBusinessDays}` : String(st.offsetBusinessDays) }) : null,
    st.actionTags.length ? st.actionTags.map((t) => tProc(`labels.actionTags.${t}`)).join(", ") : null,
    st.systemIds.length ? st.systemIds.map((id) => systemName[id] ?? tPrev("step.removedSystem")).join(", ") : null,
    st.amountMaxMinor !== null && st.currency ? tPrev("step.upTo", { amount: formatAmount(st.amountMaxMinor, st.currency) }) : null,
    st.channel ? tPrev("step.via", { channel: tProc(`labels.channels.${st.channel}`) }) : null,
    st.requiresApproval ? tPrev("step.needsApproval") : null,
  ].filter(Boolean);
  const head = `${i + 1}. ${st.title}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
  const tail = [st.output ? tPrev("step.output", { output: st.output }) : null, st.verification ? tPrev("step.verification", { verification: st.verification }) : null]
    .filter(Boolean)
    .join(". ");
  return tail ? `${head}. ${tail}` : head;
}

/// A check in the reader's language: by its key when lib gave one, the
/// R3 note merged over several steps by its steps, and a check of the
/// client's own rule by its message (the rule is the client's words).
function checkWords(tProc: LooseT, tPrev: LooseT, c: PreviewCheck & { steps?: number[] }): string {
  if (c.steps && c.steps.length > 1) {
    return tPrev("automatedSteps", { steps: c.steps.slice(0, -1).join(", "), last: String(c.steps[c.steps.length - 1]) });
  }
  const k = c.keyed;
  if (!k) return c.message;
  return tProc(`checks.${k.key}`, {
    step: k.step ?? "",
    tags: (k.tags ?? []).map((x) => tProc(`labels.actionTags.${x}`)).join(", "),
    thresholds: (k.thresholds ?? []).join(", "),
    secrets: (k.secrets ?? []).map((x) => tProc(`labels.secrets.${x}`)).join(", "),
  });
}

/// The step lines, the checks passed with an exception, and the checks
/// that hold the approval back, in the order procedurePreview gives them.
export function procedureWords(
  tProc: LooseT,
  tPrev: LooseT,
  w: { steps: ProcessStep[]; systemName: Record<string, string>; checks: PreviewCheck[] }
): { steps: string[]; excepted: string[]; problems: string[] } {
  return {
    steps: w.steps.map((st, i) => stepWords(tProc, tPrev, st, i, w.systemName)),
    excepted: w.checks.filter((c) => !holdsBack(c)).map((c) => checkWords(tProc, tPrev, c)),
    problems: mergeStepChecks(w.checks.filter(holdsBack).map((c) => ({ ...c, code: c.code ?? "" }))).map((c) =>
      c.severity === "EXCEPTION" ? `${checkWords(tProc, tPrev, c)} ${tProc("checks.exceptionNeeded")}` : checkWords(tProc, tPrev, c)
    ),
  };
}

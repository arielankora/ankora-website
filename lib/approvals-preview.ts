// What a row on "אישורים" opens to, so a person reads what they approve
// before they approve it (Ariel, 22.10.2026: a procedure's row had only
// its name, and the way to read it led to the top of the client's page).
// Pure: the domain reads the version, the rule or the plan, and this
// turns it into lines; the row shows them under "הצגת ...".

import { ACTION_TAG_LABELS, CHANNEL_LABELS, STEP_MODE_LABELS, type ProcessStep } from "@/lib/process-rules";
import { formatAmount } from "@/lib/policy-params";

export type ApprovalPreview = {
  /// The words on the toggle: "הצגת הנוהל".
  toggle: string;
  sections: { heading: string | null; lines: string[] }[];
  /// What holds the approval back, in the words of the check.
  problems: string[];
};

export type PreviewCheck = { message: string; severity: string; excepted?: boolean };

/// One line per step, as the client's page writes it.
export function stepLine(st: ProcessStep, i: number, systemName: Record<string, string>): string {
  const parts = [
    STEP_MODE_LABELS[st.mode],
    st.offsetBusinessDays !== null ? `${st.offsetBusinessDays >= 0 ? `+${st.offsetBusinessDays}` : st.offsetBusinessDays} ימי עסקים` : null,
    st.actionTags.length ? st.actionTags.map((t) => ACTION_TAG_LABELS[t]).join(", ") : null,
    st.systemIds.length ? st.systemIds.map((id) => systemName[id] ?? "מערכת שהוסרה").join(", ") : null,
    st.amountMaxMinor !== null && st.currency ? `עד ${formatAmount(st.amountMaxMinor, st.currency)}` : null,
    st.channel ? `ב${CHANNEL_LABELS[st.channel]}` : null,
    st.requiresApproval ? "דורש אישור" : null,
  ].filter(Boolean);
  const head = `${i + 1}. ${st.title}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
  const tail = [st.output ? `תוצר: ${st.output}` : null, st.verification ? `אימות: ${st.verification}` : null].filter(Boolean).join(". ");
  return tail ? `${head}. ${tail}` : head;
}

/// A check that stops the approval: anything blocking, and anything that
/// needs an exception there is none of (holdsApproval in processes.ts).
export function holdsBack(c: PreviewCheck): boolean {
  return c.severity === "BLOCK" || !c.excepted;
}

export function procedurePreview(
  v: { steps: ProcessStep[]; highlights?: string | null; outputs?: string | null },
  systemName: Record<string, string>,
  checks: PreviewCheck[]
): ApprovalPreview {
  const sections: ApprovalPreview["sections"] = [{ heading: "שלבים", lines: v.steps.map((st, i) => stepLine(st, i, systemName)) }];
  if (v.highlights?.trim()) sections.push({ heading: "דגשים", lines: [v.highlights.trim()] });
  if (v.outputs?.trim()) sections.push({ heading: "מה צריך להיות בסוף", lines: [v.outputs.trim()] });
  const passed = checks.filter((c) => !holdsBack(c));
  if (passed.length) sections.push({ heading: "בדיקות עם חריגה מאושרת", lines: passed.map((c) => c.message) });
  return {
    toggle: "הצגת הנוהל",
    sections,
    problems: checks.filter(holdsBack).map((c) => (c.severity === "EXCEPTION" ? `${c.message} אפשר לאשר רק עם חריגה מאושרת לכלל.` : c.message)),
  };
}

export function rulePreview(p: { statement: string; interimStatement?: string | null; rationale?: string | null }): ApprovalPreview {
  const sections: ApprovalPreview["sections"] = [{ heading: "הכלל", lines: [p.statement] }];
  if (p.interimStatement?.trim()) sections.push({ heading: "עד שיאושר", lines: [p.interimStatement.trim()] });
  if (p.rationale?.trim()) sections.push({ heading: "למה", lines: [p.rationale.trim()] });
  return { toggle: "הצגת הכלל", sections, problems: [] };
}

export function planPreview(p: { body: string; steps: string[] }): ApprovalPreview {
  const sections: ApprovalPreview["sections"] = [{ heading: null, lines: [p.body] }];
  if (p.steps.length) sections.push({ heading: "שלבים שהתוכנית מציעה", lines: p.steps.map((s, i) => `${i + 1}. ${s}`) });
  return { toggle: "הצגת התוכנית", sections, problems: [] };
}

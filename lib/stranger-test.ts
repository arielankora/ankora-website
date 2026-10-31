// The stranger test (31.10.2026, Ariel): "could someone who has never done
// this run it tomorrow?". Claude walks a procedure against the client's
// file as a stranger would and records where they would get stuck, as
// questions. What is still unknown is the readiness, not how many fields
// are filled. The words and the limits, pure, so the screen, the server
// and the tests read a test the same way.

export type StrangerSeverityLike = "BLOCKER" | "SLOWS" | "IMPROVES";
export type StrangerAskWhoLike = "ANKORA" | "CLIENT";

export const STRANGER_SEVERITIES = ["BLOCKER", "SLOWS", "IMPROVES"] as const;
export const STRANGER_ASK_WHO = ["ANKORA", "CLIENT"] as const;

export const STRANGER_SEVERITY_LABELS: Record<StrangerSeverityLike, string> = {
  BLOCKER: "חוסם",
  SLOWS: "יאט",
  IMPROVES: "שיפור",
};

export const STRANGER_ASK_WHO_LABELS: Record<StrangerAskWhoLike, string> = {
  ANKORA: "אצלנו",
  CLIENT: "אצל הלקוח",
};

export const MAX_STRANGER_QUESTIONS = 40;
export const MAX_STRANGER_TEXT = 1000;

/// Kinds of fact an answer may become. The ones that need more than words
/// (a temporary fact's end, a decision's date) and a question are left out.
export const ANSWER_FACT_KINDS = ["NOTE", "REQUIREMENT", "PREFERENCE", "LOCATION", "FINANCE", "SCOPE_IN", "SCOPE_OUT"] as const;
export type AnswerFactKind = (typeof ANSWER_FACT_KINDS)[number];

export type StrangerQuestionInput = {
  step?: number | null;
  severity: StrangerSeverityLike;
  askWho: StrangerAskWhoLike;
  question: string;
};

/// The questions as they will be stored, or why they cannot be. A step
/// must be one of the procedure's.
export function readStrangerQuestions(
  questions: StrangerQuestionInput[],
  stepCount: number
): { ok: true; questions: { step: number | null; severity: StrangerSeverityLike; askWho: StrangerAskWhoLike; question: string }[] } | { ok: false; error: string } {
  if (questions.length > MAX_STRANGER_QUESTIONS) return { ok: false, error: `עד ${MAX_STRANGER_QUESTIONS} שאלות במבחן אחד.` };
  const out = [];
  for (const [i, q] of questions.entries()) {
    const question = q.question?.trim();
    if (!question) return { ok: false, error: `שאלה ${i + 1} ריקה.` };
    if (question.length > MAX_STRANGER_TEXT) return { ok: false, error: `שאלה ${i + 1} ארוכה מדי.` };
    if (!STRANGER_SEVERITIES.includes(q.severity)) return { ok: false, error: `שאלה ${i + 1}: חומרה לא מוכרת.` };
    if (!STRANGER_ASK_WHO.includes(q.askWho)) return { ok: false, error: `שאלה ${i + 1}: לא ברור את מי שואלים.` };
    const step = q.step ?? null;
    if (step !== null && (!Number.isInteger(step) || step < 1 || step > stepCount)) {
      return { ok: false, error: `שאלה ${i + 1}: אין בנוהל שלב ${step}.` };
    }
    out.push({ step, severity: q.severity, askWho: q.askWho, question });
  }
  return { ok: true, questions: out };
}

/// What an answer is written as in the file: which process and step it
/// answers, then the answer, so a reader of the file knows what it is for.
export function answerFactBody(code: string, step: number | null, answer: string): string {
  return `${code}${step ? ` שלב ${step}` : ""}: ${answer.trim()}`;
}

export type StrangerState = {
  at: Date | string;
  open: number;
  blockers: number;
  answered: number;
};

const dayMonth = (d: Date | string) => {
  const [, m, day] = (typeof d === "string" ? d : d.toISOString()).slice(0, 10).split("-");
  return `${Number(day)}.${Number(m)}`;
};

/// "מבחן הזר: 2 חוסמים, 5 שאלות פתוחות · 31.10", "מבחן הזר: עבר · 31.10",
/// or "מבחן הזר: עוד לא הורץ".
export function strangerLine(s: StrangerState | null): string {
  if (!s) return "מבחן הזר: עוד לא הורץ";
  if (s.open === 0) return `מבחן הזר: עבר · ${dayMonth(s.at)}`;
  const parts: string[] = [];
  if (s.blockers) parts.push(s.blockers === 1 ? "חוסם אחד" : `${s.blockers} חוסמים`);
  parts.push(s.open === 1 ? "שאלה פתוחה אחת" : `${s.open} שאלות פתוחות`);
  return `מבחן הזר: ${parts.join(", ")} · ${dayMonth(s.at)}`;
}

/// The prompt a person pastes into Claude to run the test.
export function strangerPrompt(clientName: string, code: string, title: string): string {
  return `הרץ מבחן זר על התהליך ${code} "${title}" של ${clientName}: קרא את התהליך, את תיק הלקוח, את המסמכים ואת הלקחים מריצות קודמות, עבור על כל שלב כאילו אתה מישהו שמעולם לא עשה את זה, ורשום עם record_stranger_test כל מקום שבו היית נתקע. אחר כך שאל אותי את השאלות אחת אחת, ורשום כל תשובה עם answer_stranger_question.`;
}

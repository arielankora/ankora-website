// "קדם עם קלוד" (10.10.2026): the prompt behind the button on the task
// screen.
//
// Pure and free of project imports, so tests/unit runs it in the sandbox
// (the same convention as lib/client-activity-prompt.ts, which does the
// same job for the client activity summary). The page reads the task, its
// steps, thread, decisions, files and plan, formats every date and label
// in the reader's language, and hands the result to this function. Nothing
// here touches the database, and nothing here decides what may be shown:
// the caller passes only what the person pressing the button can already
// see on the screen.
//
// What is deliberately NOT in the input, so it can never reach the prompt:
// the client's logins from the vault, payment cards, bank details and the
// client's contact details. A pasted prompt leaves the product, and those
// have no business in a work plan. Claude can still read a task through
// the MCP connection, which applies the same access rules as the screen.
//
// The prompt is written in Hebrew because the conversation it starts is in
// Hebrew. Tool names, the task id and field values stay as they are.

export type AdvancePromptStep = {
  title: string;
  statusLabel: string;
  assignedTo: string | null;
  dueLabel: string | null;
};

export type AdvancePromptComment = { atLabel: string; by: string | null; body: string };

export type AdvancePromptDecision = { question: string; statusLabel: string; dueLabel: string | null };

export type AdvancePromptPlan = {
  version: number;
  approved: boolean;
  body: string;
  steps: string[];
};

export type AdvancePromptInput = {
  taskId: string;
  url: string;
  title: string;
  clientName: string;
  statusLabel: string;
  priorityLabel: string;
  categoryName: string | null;
  assignedTo: string | null;
  supervisor: string | null;
  requiresApproval: boolean;
  dueLabel: string | null;
  createdLabel: string;
  description: string | null;
  clientVisible: boolean;
  clientTitle: string | null;
  clientRequest: string | null;
  clientOutcome: string | null;
  waiting: { onLabel: string; reason: string | null; sinceLabel: string | null } | null;
  steps: AdvancePromptStep[];
  /// Oldest first, already capped by the caller.
  comments: AdvancePromptComment[];
  /// How many older comments were left out to keep the prompt readable.
  commentsOmitted: number;
  decisions: AdvancePromptDecision[];
  fileTitles: string[];
  loggedLabel: string | null;
  plan: AdvancePromptPlan | null;
  requestedBy: string;
  todayLabel: string;
};

/// Long descriptions and comments are cut, not dropped: the beginning of a
/// long text is usually the brief, and Claude can read the rest through
/// get_task when it needs it.
export const MAX_DESCRIPTION_CHARS = 6000;
export const MAX_COMMENT_CHARS = 1500;
export const MAX_PLAN_CHARS = 12000;

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}\n[...הטקסט קוצר. המלא זמין דרך get_task]` : t;
}

/// A line "label: value", or nothing when there is no value. Keeps the
/// task section free of "לא צוין" noise that Claude would have to read past.
function line(label: string, value: string | null | undefined): string[] {
  const v = value?.trim();
  return v ? [`- ${label}: ${v}`] : [];
}

function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

export function buildAdvancePrompt(input: AdvancePromptInput): string {
  const hasPlan = input.plan !== null;
  const baseVersion = input.plan?.version ?? 0;
  const out: string[] = [];

  // ---- Who, what, and the one rule that matters most ---------------------
  out.push(
    `אני ${input.requestedBy} מצוות אנקורה. אני רוצה לקדם את סגירת המשימה "${input.title}" של הלקוח ${input.clientName}, ואתה עובד איתי עליה.`,
    "",
    "כל נתוני המשימה מופיעים בסוף ההודעה. אל תבצע שום פעולה ואל תכתוב למערכת לפני שאני מאשר במפורש.",
    ""
  );

  // ---- The flow -----------------------------------------------------------
  out.push("## איך עובדים");
  if (hasPlan) {
    out.push(
      `1. למשימה כבר יש תוכנית עבודה ${input.plan!.approved ? "מאושרת" : "בטיוטה"} (גרסה ${baseVersion}), והיא מופיעה למטה. תציג לי אותה בקצרה ותשאל אם לעדכן אותה או להתחיל לבצע.`,
      "2. אם אני מבקש לעדכן: תציג את התוכנית המעודכנת כולה, לא רק את השינוי, ותכתוב בשורה אחת מה השתנה."
    );
  } else {
    out.push(
      "1. תקרא את הנתונים. אם חסר מידע שבלעדיו אי אפשר לתכנן, תשאל עד שלוש שאלות ממוקדות לפני הכול. אחרת, תציג לי תוכנית עבודה במבנה שלמטה.",
      "2. אם אני מתקן: תעדכן ותציג את התוכנית המלאה מחדש, עם שורה אחת על מה השתנה."
    );
  }
  out.push(
    `3. רק אחרי שכתבתי במפורש שאני מאשר, תשמור את התוכנית במערכת עם save_task_plan: taskId "${input.taskId}", הטקסט המלא ב-plan, כותרות השלבים ב-steps, approved: true, ו-baseVersion: ${baseVersion}. אם אני מבקש לשמור בלי לאשר, approved: false.`,
    "4. אחרי השמירה, תשאל אם להפוך את השלבים לשלבים במשימה (apply_task_plan_steps). תגיד לי שזה מחליף את השלבים הפתוחים, ושלבים שבוצעו או שדווח עליהם זמן נשארים.",
    "5. אם אבקש לבצע, תעבוד שלב אחרי שלב לפי התוכנית, ותסמן כל שלב שהסתיים עם set_task_step.",
    ""
  );

  // ---- What may be done without asking -----------------------------------
  out.push(
    "## מה מותר בלי לשאול, ומה לא",
    "- בלי לשאול: לקרוא נתונים, לחקור, לנסח טיוטות, להוסיף הערה פנימית במשימה (add_task_comment) ולסמן שלב שהסתיים.",
    "- רק אחרי אישור שלי: לסגור את המשימה, לשנות אחראי, תאריך יעד או עדיפות, לדווח זמן, לפתוח החלטה ללקוח, וכל דבר שהלקוח רואה.",
    "- אף פעם: לשלוח משהו ללקוח או לספק בעצמך. אתה מנסח, אני שולח.",
    "- אם התוכנית משתנה תוך כדי ביצוע, תציע גרסה חדשה ותשמור אותה רק אחרי אישור. לא משנים תוכנית בשקט.",
    `- אם save_task_plan מחזיר שנשמרה גרסה חדשה יותר, תקרא אותה עם get_task_plan, תראה לי מה שונה ותשאל לפני שאתה שומר.`,
    ""
  );

  // ---- The shape of a plan -------------------------------------------------
  out.push(
    "## מבנה התוכנית",
    "בלי כותרות עם #. כותרת כל חלק מודגשת (**כך**), והתוכן ברשימות. העברית פשוטה, המשפטים קצרים, ובלי קו מפריד ארוך.",
    "- **מטרה**: משפט אחד. איך נראית המשימה כשהיא סגורה.",
    "- **מה ידוע**: התמצית מהנתונים, בלי לחזור על כולם.",
    "- **מה חסר**: שאלות פתוחות שצריך לענות עליהן. אם אין, לכתוב \"אין\".",
    "- **שלבים**: רשימה ממוספרת. לכל שלב: מה עושים, מי מבצע (קלוד, שם מנהל התפעול, הלקוח או ספק), במה הוא תלוי, וזמן משוער.",
    "- **החלטות של הלקוח**: מה הלקוח צריך להחליט. אם אין, לכתוב \"אין\".",
    "- **סיכונים**: מה עלול להשתבש ומה עושים אז.",
    `- **סיום**: מתי המשימה נחשבת סגורה.${input.clientVisible ? " המשימה מוצגת ללקוח, אז לכלול גם הצעה למשפט התוצאה שהלקוח יקרא." : ""}`,
    "",
    "ב-steps של save_task_plan: כותרת קצרה לכל שלב ממוספר, שורה אחת, בגוף ציווי, עד 15 שלבים, באותו סדר.",
    ""
  );

  // ---- The connection -----------------------------------------------------
  out.push(
    "## החיבור למערכת",
    `הנתונים והכתיבה עוברים דרך החיבור של אנקורה (Ankora MCP). תזהה את המשימה תמיד לפי taskId "${input.taskId}" ולא לפי הכותרת.`,
    "אם החיבור לא זמין בשיחה הזו, תגיד לי לחבר אותו ואל תמציא נתונים. את התוכנית אפשר לבנות גם בלעדיו, רק לא לשמור אותה.",
    ""
  );

  // ---- The data ------------------------------------------------------------
  out.push(
    "## נתוני המשימה",
    `נכון ל-${input.todayLabel}.`,
    `- מזהה: ${input.taskId}`,
    `- קישור: ${input.url}`,
    `- כותרת: ${input.title}`,
    `- לקוח: ${input.clientName}`,
    `- סטטוס: ${input.statusLabel}`,
    `- עדיפות: ${input.priorityLabel}`,
    ...line("קטגוריה", input.categoryName),
    ...line("אחראי", input.assignedTo),
    ...line("מפקח", input.supervisor ? `${input.supervisor}${input.requiresApproval ? " (נדרש אישור שלו לסגירה)" : ""}` : null),
    ...line("תאריך יעד", input.dueLabel),
    `- נפתחה: ${input.createdLabel}`,
    ...line("זמן שדווח", input.loggedLabel),
    ...(input.waiting
      ? [
          `- ממתינה ל: ${input.waiting.onLabel}${input.waiting.sinceLabel ? `, מאז ${input.waiting.sinceLabel}` : ""}${input.waiting.reason ? `. הסיבה: ${input.waiting.reason}` : ""}`,
        ]
      : []),
    `- מוצגת ללקוח בפורטל: ${input.clientVisible ? "כן" : "לא"}`,
    ...(input.clientVisible ? line("הכותרת שהלקוח רואה", input.clientTitle) : []),
    ...(input.clientVisible ? line("מה ביקשנו מהלקוח", input.clientRequest) : []),
    ...line("משפט התוצאה ללקוח", input.clientOutcome),
    ""
  );

  out.push("### תיאור");
  out.push(input.description?.trim() ? clip(input.description, MAX_DESCRIPTION_CHARS) : "אין תיאור.");
  out.push("");

  out.push("### שלבים קיימים");
  if (input.steps.length === 0) out.push("אין שלבים.");
  else
    input.steps.forEach((s, i) => {
      const extra = [s.assignedTo, s.dueLabel ? `יעד ${s.dueLabel}` : null].filter(Boolean).join(", ");
      out.push(`${i + 1}. ${s.title} (${s.statusLabel}${extra ? `, ${extra}` : ""})`);
    });
  out.push("");

  out.push("### הערות בשרשור");
  if (input.comments.length === 0) out.push("אין הערות.");
  else {
    if (input.commentsOmitted > 0) out.push(`(${input.commentsOmitted} הערות ישנות יותר לא נכללו. אפשר לקרוא אותן עם get_task.)`);
    for (const c of input.comments) {
      out.push(`${c.atLabel}, ${c.by ?? "לא ידוע"}:`);
      out.push(quoteBlock(clip(c.body, MAX_COMMENT_CHARS)));
    }
  }
  out.push("");

  if (input.decisions.length > 0) {
    out.push("### החלטות של הלקוח שקשורות למשימה");
    for (const d of input.decisions) out.push(`- ${d.question} (${d.statusLabel}${d.dueLabel ? `, עד ${d.dueLabel}` : ""})`);
    out.push("");
  }

  if (input.fileTitles.length > 0) {
    out.push("### קבצים מצורפים");
    for (const f of input.fileTitles) out.push(`- ${f}`);
    out.push("");
  }

  if (input.plan) {
    out.push(`### תוכנית העבודה הנוכחית (גרסה ${input.plan.version}, ${input.plan.approved ? "מאושרת" : "טיוטה"})`);
    out.push(clip(input.plan.body, MAX_PLAN_CHARS));
    if (input.plan.steps.length > 0) {
      out.push("", "שלבי התוכנית:");
      input.plan.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
    }
    out.push("");
  }

  out.push(hasPlan ? "תתחיל בהצגת התוכנית הקיימת בקצרה." : "תתחיל.");
  return out.join("\n");
}

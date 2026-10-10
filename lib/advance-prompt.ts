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
  /// When it closed. Only for a finished task, and only the lessons prompt
  /// reads it.
  completedLabel?: string | null;
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

/// How Claude asks (Ariel, 11.10.2026). An open question on a phone is a
/// paragraph to type; a question with ready answers is one tap. The Claude
/// apps can show a question as a card with answer buttons; asked only "if
/// you have such a tool", Claude wrote the questions as text instead, so
/// the tool comes first and by name, and text is the fallback. Every
/// question comes with choices, the recommended one first and marked, and
/// room to answer in his own words.
export const HOW_TO_ASK: readonly string[] = [
  "## איך שואלים אותי",
  "כל שאלה שאתה שואל, בכל שלב בשיחה, באה עם תשובות מוכנות שאני בוחר בלחיצה.",
  "- **קודם כול, כלי השאלות של האפליקציה.** אם יש לך כלי שמציג לי שאלה עם כפתורי תשובה (למשל ask_user_input), תשתמש בו לכל שאלה, ואל תכתוב את אותן שאלות גם בטקסט. שאלה אחת לכל כרטיס, עד שלוש שאלות בכל פעם, ותחכה לתשובות לפני שאתה ממשיך.",
  "- בכל שאלה 2 עד 4 תשובות קצרות. התשובה שאתה ממליץ עליה ראשונה, ובסוף שלה \"(מומלץ)\". אם צריך נימוק, משפט אחד מעל הכרטיס.",
  "- תמיד אפשר לענות אחרת: אם בכלי אין אפשרות לטקסט חופשי, תכתוב שורה אחת שאפשר גם פשוט לכתוב לך תשובה.",
  "- רק אם אין לך כלי כזה בשיחה: אותו מבנה בטקסט. תשובות ממוספרות באותיות (א, ב, ג, ד), המומלצת ראשונה ומסומנת, בסוף כל שאלה \"או לכתוב תשובה אחרת\", ואפשר לענות בקיצור כמו \"1א 2ג\".",
  "",
];

/// No description and no comment: nothing a person wrote down.
export function isEmptyBrief(input: Pick<AdvancePromptInput, "description" | "comments">): boolean {
  return !input.description?.trim() && input.comments.length === 0;
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
  } else if (isEmptyBrief(input)) {
    // Nothing written on the task at all. A plan built from a title alone
    // is a guess dressed as a plan, so the conversation starts with what
    // is missing.
    out.push(
      "1. במשימה אין תיאור ואין הערות, אז אין עדיין ממה לתכנן. תתחיל בשאלות הבהרה ממוקדות (עד חמש, כל אחת עם תשובות לבחירה), ותציג תוכנית רק אחרי שאענה.",
      "2. אם אני מתקן: תעדכן ותציג את התוכנית המלאה מחדש, עם שורה אחת על מה השתנה."
    );
  } else {
    out.push(
      "1. תקרא את הנתונים. אם חסר מידע שבלעדיו אי אפשר לתכנן, תשאל עד שלוש שאלות ממוקדות לפני הכול, כל אחת עם תשובות לבחירה. אחרת, תציג לי תוכנית עבודה במבנה שלמטה.",
      "2. אם אני מתקן: תעדכן ותציג את התוכנית המלאה מחדש, עם שורה אחת על מה השתנה."
    );
  }
  out.push(
    `3. רק אחרי שכתבתי במפורש שאני מאשר, תשמור את התוכנית במערכת עם save_task_plan: taskId "${input.taskId}", הטקסט המלא ב-plan, כותרות השלבים ב-steps, approved: true, ו-baseVersion: ${baseVersion}. אם אני מבקש לשמור בלי לאשר, approved: false.`,
    "4. אחרי השמירה, תשאל אם להפוך את השלבים לשלבים במשימה (apply_task_plan_steps). תגיד לי שזה מחליף את השלבים הפתוחים, ושלבים שבוצעו או שדווח עליהם זמן נשארים.",
    "5. אם אבקש לבצע, תעבוד שלב אחרי שלב לפי התוכנית. כשמסתיים שלב: תסמן אותו עם set_task_step, ותוסיף הערה קצרה במשימה (add_task_comment) על מה נעשה ומה יצא, כדי שמי שיפתח את המשימה אחריי יבין איפה היא עומדת.",
    ""
  );

  out.push(...HOW_TO_ASK);

  // ---- What may be done without asking -----------------------------------
  out.push(
    "## מה מותר בלי לשאול, ומה לא",
    "- בלי לשאול: לקרוא נתונים, לחקור, לנסח טיוטות, להוסיף הערה פנימית במשימה (add_task_comment) ולסמן שלב שהסתיים.",
    "- רק אחרי אישור שלי: לסגור את המשימה, לשנות אחראי, תאריך יעד או עדיפות, לדווח זמן, לפתוח החלטה ללקוח, וכל דבר שהלקוח רואה.",
    "- החלטה שהלקוח צריך לקבל: אחרי אישור שלי, אפשר לפתוח אותה בפורטל שלו עם create_decision ולקשר אותה למשימה עם taskId. הלקוח לא מקבל הודעה אוטומטית, אז תזכיר לי לעדכן אותו.",
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

  out.push(...taskDataSection(input));

  out.push(hasPlan ? "תתחיל בהצגת התוכנית הקיימת בקצרה." : "תתחיל.");
  return out.join("\n");
}

/// "נתוני המשימה": everything the screen knows, the same for both prompts.
function taskDataSection(input: AdvancePromptInput): string[] {
  const out: string[] = [];
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
    ...line("נסגרה", input.completedLabel),
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

  return out;
}

/// The prompt for a task that is already closed: not a plan, a short
/// summary of what happened and what to learn from it.
///
/// "Advance" makes no sense on finished work, but the same button has a
/// job there. A closed task is the cheapest moment to write down why it
/// took three weeks instead of three days, and the most common moment for
/// nobody to. The summary is saved as an internal comment, after the
/// person approves it, so it stays on the task and never reaches the
/// client.
export function buildLessonsPrompt(input: AdvancePromptInput): string {
  const out: string[] = [];
  out.push(
    `אני ${input.requestedBy} מצוות אנקורה. המשימה "${input.title}" של הלקוח ${input.clientName} נסגרה (${input.statusLabel}), ואני רוצה לסכם אותה ולהפיק ממנה לקחים.`,
    "",
    "כל נתוני המשימה מופיעים בסוף ההודעה. אל תכתוב למערכת לפני שאני מאשר במפורש.",
    "",
    "## איך עובדים",
    "1. תכתוב סיכום קצר במבנה שלמטה, מתוך הנתונים בלבד. מה שלא מופיע בנתונים, לא להמציא: לכתוב שזה לא ידוע.",
    "2. אם אני מתקן, תעדכן ותציג את הסיכום המלא מחדש.",
    `3. רק אחרי שכתבתי במפורש שאני מאשר, תשמור את הסיכום כהערה פנימית במשימה עם add_task_comment: taskId "${input.taskId}", includeDone: true. עד 4000 תווים. הערות לא מוצגות ללקוח.`,
    "4. אם עולה לקח שכדאי להפוך לנוהל או לשלבים קבועים במשימות דומות, תציע אותו בנפרד בסוף. אל תשנה שום דבר אחר במשימה, ואל תפתח אותה מחדש.",
    "",
    ...HOW_TO_ASK,
    "## מבנה הסיכום",
    "בלי כותרות עם #. כותרת כל חלק מודגשת (**כך**), והתוכן ברשימות. העברית פשוטה, המשפטים קצרים, ובלי קו מפריד ארוך.",
    "- **מה היה צריך לקרות**: משפט אחד.",
    "- **מה קרה בפועל**: התוצאה, ומה הלקוח קיבל.",
    "- **זמן ומאמץ**: מהפתיחה ועד הסגירה, והזמן שדווח.",
    "- **מה עבד**",
    "- **מה התעכב או לא עבד**: ולמה, לפי מה שכתוב בנתונים.",
    "- **לקחים**: עד שלושה, כל אחד משפט אחד שאפשר לפעול לפיו בפעם הבאה.",
    "",
    "## החיבור למערכת",
    `הנתונים והכתיבה עוברים דרך החיבור של אנקורה (Ankora MCP). תזהה את המשימה תמיד לפי taskId "${input.taskId}" ולא לפי הכותרת.`,
    "אם החיבור לא זמין בשיחה הזו, תגיד לי לחבר אותו ואל תמציא נתונים.",
    ""
  );
  out.push(...taskDataSection(input));
  out.push("תתחיל.");
  return out.join("\n");
}

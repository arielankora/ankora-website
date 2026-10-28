// "קדם עם קלוד" (10.10.2026): the prompt behind the button on the task
// screen.
//
// Pure, importing only other pure modules, so tests/unit runs it in the sandbox
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

import { NO_AI_MEETING_RULE } from "./ai-exclusion";
import { PROPOSE_MAPPING_STEP_TITLE, PROPOSE_STEP_TITLE } from "./procedure-to-file";

export type AdvancePromptStep = {
  title: string;
  statusLabel: string;
  assignedTo: string | null;
  dueLabel: string | null;
};

export type AdvancePromptComment = { atLabel: string; by: string | null; body: string };

export type AdvancePromptDecision = { question: string; statusLabel: string; dueLabel: string | null };

/// A document filed on the task. The id is what read_document takes; the
/// prompt carries it because a title is ambiguous and Claude would
/// otherwise have to list before it could read.
export type AdvancePromptFile = {
  documentId: string;
  title: string;
  /// "PDF", "Word", "תמונה": what the file is, in a word.
  typeLabel: string;
  sizeLabel: string | null;
  atLabel: string;
  by: string | null;
  clientVisible: boolean;
};

/// What a file is, in a word, from its MIME type.
export function fileTypeLabel(mimeType: string): string {
  const t = mimeType.toLowerCase();
  if (t === "application/pdf") return "PDF";
  if (t.includes("wordprocessingml") || t === "application/msword") return "Word";
  if (t.includes("spreadsheetml") || t === "application/vnd.ms-excel" || t === "text/csv") return "Excel";
  if (t.includes("presentationml") || t === "application/vnd.ms-powerpoint") return "PowerPoint";
  if (t.startsWith("image/")) return "תמונה";
  if (t.startsWith("text/")) return "טקסט";
  return "קובץ";
}

/// "320KB", "1.4MB".
export function fileSizeLabel(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export type AdvancePromptPlan = {
  version: number;
  approved: boolean;
  body: string;
  steps: string[];
};

/// Where the client's material lives outside Ankora (22.10.2026): the
/// anchors from the client file. Domains are firms' domains, not people's
/// addresses, so they may travel in a pasted prompt; a person's address
/// stays one lookup_contact away.
export type AdvancePromptSources = {
  clientDomains: string[];
  /// Suppliers' and partners' domains (nextage.co.il). A partner may work
  /// for several clients, so its domain alone never makes a message this
  /// client's.
  partnerDomains: string[];
  keywords: string[];
  driveFolderId: string | null;
  conversationsDocId: string | null;
  /// 90 days before the task opened: the oldest material worth reading.
  fromLabel: string;
  /// The same day as YYYY-MM-DD, for search filters (after:, from:).
  fromIso: string;
};

/// How far back the search goes, from the day the task opened.
export const SOURCES_LOOKBACK_DAYS = 90;

export type AdvancePromptInput = {
  taskId: string;
  /// A run of a process (spec 5.4): its code and title. The lessons
  /// prompt then also asks about the procedure.
  process?: { code: string; title: string } | null;
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
  files: AdvancePromptFile[];
  loggedLabel: string | null;
  plan: AdvancePromptPlan | null;
  /// The task is in a handover's "mapping and watching" stage
  /// (isMappingTask). What it learns goes to the client file before it
  /// closes, even when no document came out of it.
  mapping?: boolean;
  /// The client's anchors for mail, Drive and recordings. Null on the
  /// lessons prompt, which reads only what is in Ankora.
  sources?: AdvancePromptSources | null;
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
  "- בכל שאלה 2 עד 4 תשובות קצרות. התשובה שאתה ממליץ עליה ראשונה, ובסוף שלה \"(מומלץ)\". אם צריך נימוק, משפט אחד בתוך השאלה עצמה, כי טקסט שמעל הכרטיס לא תמיד מוצג.",
  "- תמיד אפשר לענות אחרת: אם בכלי אין אפשרות לטקסט חופשי, תכתוב שורה אחת שאפשר גם פשוט לכתוב לך תשובה.",
  "- רק אם אין לך כלי כזה בשיחה: אותו מבנה בטקסט. תשובות ממוספרות באותיות (א, ב, ג, ד), המומלצת ראשונה ומסומנת, בסוף כל שאלה \"או לכתוב תשובה אחרת\", ואפשר לענות בקיצור כמו \"1א 2ג\".",
  "",
];

/// The timer around a "קדם עם קלוד" conversation (Ariel, 19.10.2026).
///
/// Work done with Claude is work on the client, and it went unrecorded
/// whenever nobody remembered to start a clock. So the conversation opens
/// by looking at what is running, live through get_active_timer rather
/// than from a snapshot taken when the prompt was copied (it may be
/// pasted hours later), and asks only when nothing runs on this client.
///
/// A timer on another client is reported, never judged: whether to stop
/// it, run both or skip is the operations manager's call, so the three
/// answers carry no recommendation (Ariel, 19.10.2026). The same timer is
/// offered for stopping when the work ends, after a second look, because
/// it may have been stopped on the screen in the meantime.
///
/// Everything the person needs in order to decide goes INSIDE the card's
/// question (acceptance test, 19.10.2026): in claude.ai a question card
/// was shown without the text Claude meant to put above it, so a proposed
/// note was written without being seen, and "since when" and "for how
/// long" never reached the screen. What sits in the question always does.
///
/// `mode` "lessons" is the closed-task summary: there the work ends when
/// the summary is saved.
export function timerRules(
  input: Pick<AdvancePromptInput, "clientName" | "title"> & { categoryName?: string | null },
  mode: "advance" | "lessons"
): string[] {
  const client = input.clientName;
  // The category a timer on this task will run under: the task's own, or
  // one start_timer picks when the task has none (Ariel, 19.10.2026: say
  // which, inside the question).
  const category = input.categoryName?.trim()
    ? `בקטגוריה \"${input.categoryName.trim()}\"`
    : "בקטגוריה שתיבחר אוטומטית";
  const end =
    mode === "advance"
      ? "כשהמשימה נסגרת או עוברת לאישור, כשמסומן השלב האחרון, או כשאני אומר שאני עוצר להיום"
      : "כשהסיכום נשמר, או כשאני אומר שאני עוצר להיום";
  return [
    "## טיימר",
    "- בתחילת השיחה, לפני כל דבר אחר, תבדוק עם get_active_timer אילו טיימרים רצים לי.",
    "- **כרטיס שאלה מוצג לי בלי הטקסט שלפניו.** לכן כל מה שאני צריך לראות כדי להחליט (לקוח, משימה, הערה, משך, שעת התחלה) נכתב בתוך השאלה עצמה, לא מעליה.",
    `- רץ טיימר על הלקוח ${client}: לא שואלים עליו. אם בתשובה הראשונה שלך יש כרטיס, השאלה שלו נפתחת במשפט "טיימר רץ על <משימה או קטגוריה> מ-<שעה>." אחרת, זו השורה הראשונה בתשובה.`,
    `- אין טיימר רץ: השאלה הראשונה שלך היא אם להפעיל טיימר, וההערה המוצעת בתוך השאלה: "להפעיל טיימר על ${client}, המשימה \"${input.title}\", ${category}, עם ההערה \"<ההערה המוצעת>\"?". תשובות: "להפעיל" (מומלץ), "להפעיל עם הערה אחרת", "בלי טיימר".`,
    "- רץ טיימר על לקוח אחר: הלקוח ושעת ההתחלה בתוך השאלה: \"רץ טיימר על <לקוח> מ-<שעה>. מה לעשות?\". ההחלטה שלי, אז בלי המלצה ובלי \"(מומלץ)\". תשובות: \"להפעיל כאן במקביל (הזמן נספר במלואו לשני הלקוחות)\", \"לעצור את הטיימר של הלקוח השני ולהתחיל כאן\", \"בלי טיימר\".",
    "- רצים כבר שני טיימרים, ואף אחד מהם לא על הלקוח הזה: שניהם, עם הלקוח ושעת ההתחלה, בתוך השאלה. תשאל, בלי המלצה, אם לעצור אחד מהם (ואיזה) כדי להתחיל כאן, או להמשיך בלי טיימר.",
    `- הפעלה: start_timer עם client "${client}", task "${input.title}" וההערה שאישרתי. confirmParallel: true רק אם בחרתי במקביל. אחרי ההפעלה, הקטגוריה שהטיימר רץ בה (מהתשובה של start_timer) נכנסת לשאלה של הכרטיס הבא, או לשורה הראשונה אם אין כרטיס.`,
    "- עצירה של טיימר אחר: stop_timer עם ה-client שלו. אם הכלי מבקש הערה, תציע הערה ותשאל לפני שאתה עוצר.",
    `- סוף העבודה: ${end}. אז תבדוק שוב עם get_active_timer. אם רץ טיימר על ${client}, תציע לעצור אותו עם הערת סיכום של מה שנעשה בשיחה, כשהמשך וההערה בתוך השאלה: "הטיימר רץ <משך>. לעצור עם ההערה \"<ההערה>\"?". תשובות: "לעצור עם ההערה הזו" (מומלץ), "לעצור עם הערה אחרת", "להשאיר רץ".`,
    "- כל שדה שאתה ממלא (משימה, הערה, קטגוריה) מוצג לי לפני הכתיבה, ואפשר לשנות אותו. לא כותבים ערך שלא ראיתי.",
    "",
  ];
}

/// Mail, Drive and recordings (Ariel, 22.10.2026).
///
/// What a person can reach differs by client and by person: at NUX Hadas
/// has the client's Drive and mailbox connected and Ariel has neither,
/// though NUX mail reaches him forwarded; Ariel sees every recording in
/// Fireflies and others may see only their own. So nothing here assumes a
/// connector is there. Claude looks at what this conversation actually
/// has, uses all of it, and says in one line what the plan rests on. When
/// a source is connected, using it is not optional: the thread with the
/// supplier is usually where the task really stands.
///
/// The anchors say where to look, never what may be read: each person's
/// own connectors decide that. The seven rules are the privacy decision
/// of the same day, word for word in substance.
export function sourcesRules(input: Pick<AdvancePromptInput, "clientName" | "taskId">, src: AdvancePromptSources): string[] {
  const anchors: string[] = [];
  if (src.clientDomains.length > 0) anchors.push(`- דומיינים של הלקוח: ${src.clientDomains.join(", ")}`);
  if (src.partnerDomains.length > 0)
    anchors.push(`- דומיינים של ספקים ושותפים: ${src.partnerDomains.join(", ")}. שותף יכול לעבוד עם כמה לקוחות, ולכן דומיין כזה לבד לא הופך מייל או פגישה לשל הלקוח הזה: צריך גם משתתף מהלקוח, מילת מפתח, או נושא המשימה.`);
  if (src.keywords.length > 0) anchors.push(`- מילות מפתח בכותרת: ${src.keywords.join(", ")}`);
  if (src.driveFolderId) anchors.push(`- תיקיית השיחות בדרייב: ${src.driveFolderId} (חיפוש עם parentId)`);
  if (src.conversationsDocId) anchors.push(`- המסמך המצטבר של השיחות: ${src.conversationsDocId}`);
  anchors.push("- מילים מכותרת המשימה ומהתיאור שלה.");
  const noAnchors = src.clientDomains.length === 0 && src.keywords.length === 0 && !src.driveFolderId;

  return [
    "## מקורות נוספים: מייל, דרייב והקלטות",
    "מה מחובר שונה מעובד לעובד ומלקוח ללקוח. לכן אל תניח שמקור מחובר, ואל תוותר על מקור שמחובר.",
    "- **לפני שאתה מתכנן:** תבדוק אילו כלים יש לך בשיחה הזו: מייל (Gmail), דרייב (Google Drive) והקלטות (Fireflies). בכל מקור מחובר תריץ חיפוש קצר לפי העוגנים שלמטה, ותקרא את מה שרלוונטי למשימה. כשהמקור מחובר, זה חובה ולא רשות.",
    // Hadas's run (23.10.2026): with the client's own mailbox connected
    // (office@nux.ai) the client's domain matched almost every thread, and
    // only words from the task narrowed it down.
    "- **מייל:** קודם תבדוק של מי התיבה המחוברת. תיבה בדומיין של הלקוח (למשל office@ של הלקוח) שייכת ללקוח, ולכן הדומיין לא מסנן בה כלום: מחפשים בה לפי מילים מכותרת המשימה ומהתיאור, ולפי מילות המפתח. תיבה של אנקורה: המייל של הלקוח מגיע אליה בהעברה או בהעתק, ומחפשים לפי הדומיינים בשולח, בנמענים ובגוף ההודעה, יחד עם מילים מהמשימה.",
    // The conversations folder lives in one person's Drive; another
    // person's connected account may not see it, while a search by the
    // task's own words found the one relevant file (23.10.2026).
    "- **דרייב:** מחפשים בתיקיית השיחות ובמסמך המצטבר אם הם בעוגנים, וגם בכל הדרייב לפי מילים מהמשימה יחד עם שם הלקוח או מילות המפתח. תיקייה או מסמך מהעוגנים שלא נגישים: לכתוב \"לא משותף עם החשבון המחובר\" ולהמשיך.",
    // Keyword search in Fireflies missed the key meeting ("Guy / Ariel",
    // the client's name transcribed as Nax); only participants found it.
    "- **הקלטות (Fireflies):** החשבון משותף לכמה לקוחות, ולכן אף פעם לא מחפשים לפי תאריך בלבד. מחפשים לפי משתתפים מהלקוח (כתובות בדומיין של הלקוח שעלו במיילים שנמצאו או במשימה), ולפי מילות המפתח בכותרת ובתמלול. התמלול כותב שמות לפעמים אחרת, ולכן כדאי לנסות כמה כתיבים. פגישה של לקוח אחר שעלתה בחיפוש: לא פותחים אותה.",
    // 28.10.2026: "בלי AI" in a recorded meeting (lib/ai-exclusion.ts).
    NO_AI_MEETING_RULE,
    `- טווח: מ-${src.fromLabel} (${SOURCES_LOOKBACK_DAYS} יום לפני פתיחת המשימה) ועד היום. במייל: after:${src.fromIso.replace(/-/g, "/")}. ב-Fireflies: from:${src.fromIso}.`,
    "- מקור שלא מחובר: שורה אחת שהוא לא היה זמין, וממשיכים. לא עוצרים בגללו.",
    "- **בתוכנית:** בחלק \"מה ידוע\", שורה ראשונה שמתחילה ב\"מקורות:\". מה נבדק ומאיזה חשבון (למשל איזו תיבת מייל), מה נמצא (מספר שרשורים, קבצים ופגישות), ומה לא היה זמין או לא היה משותף.",
    "",
    "### העוגנים של הלקוח",
    ...anchors,
    ...(noAnchors
      ? [`- בתיק הלקוח עוד אין דומיינים או מילות מפתח. תחפש לפי שם הלקוח (${input.clientName}) ונושא המשימה, תסמן כל ממצא כ\"לא ודאי שהוא של הלקוח\", ותציע לי להוסיף עוגנים לתיק (לשונית מקורות).`]
      : []),
    "",
    "### כללי פרטיות",
    "1. מחפשים רק לפי העוגנים של הלקוח. מה שלא מתאים להם לא נכנס, וזה כולל מייל אישי של העובד.",
    "2. מייל או פגישה שעוסקים גם בלקוח אחר: לוקחים רק את החלק של הלקוח הזה. פרטים של לקוח אחר לא נכנסים לתוכנית, להערות או לתיק, ופגישות וקבצים של לקוח אחר לא פותחים.",
    "3. כללי \"לא לספר\" בתיק הלקוח חלים גם על מה שנמצא במקורות.",
    "4. לא מעתיקים סיסמאות, קודים או פרטי גישה לתוכנית, להערות או לתיק, גם כשהם מופיעים במייל או בסיכום אוטומטי של פגישה. כותבים רק שהפרט קיים, ואיפה.",
    "5. לכל פרט מהמקורות מצורף המקור: מי כתב או אמר, מתי, וקישור (מייל, קובץ, פגישה עם הדקה).",
    "6. מידע ממקור שמחובר רק אצלך (למשל תיבה משותפת של הלקוח או דרייב שלא משותף עם הצוות): מותר בתוכנית ובהערות הפנימיות, עם המקור. לתיק הלקוח הוא נכנס רק דרך הצעת ידע שממתינה לאישור.",
    "7. שום דבר מהמקורות לא נכנס לשדה שהלקוח רואה בלי אישור שלי.",
    "",
    "### ידע שעוד לא בתיק",
    `- פגישה או שרשור מייל של הלקוח שיש בהם ידע קבוע (כלל, תהליך, איש קשר, מערכת, תאריך) שעוד לא בתיק: להציע אותו עם propose_knowledge, client "${input.clientName}". מקור: פגישה כ-newSource מסוג TRANSCRIPT עם firefliesId. שרשור מייל כ-newSource מסוג EMAIL עם gmailThreadId. מקור שכבר במרשם (get_client_file מציג אותו): sourceCode.`,
    "- ההצעות ממתינות לאישור מנהל במסך הבדיקה, ולכן מותר לשלוח אותן בלי לשאול. אחר כך להזכיר לי לאשר. דברים שקשורים רק למשימה עצמה נשארים בתוכנית ולא נכנסים לתיק.",
    "",
  ];
}

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
  if (input.files.length > 0) {
    // Files are part of the brief. A signed form or a quote often answers
    // the question Claude would otherwise ask, so they are read first.
    out.push(
      `לפני הכול: למשימה מצורפים ${input.files.length === 1 ? "קובץ אחד" : `${input.files.length} קבצים`} (הרשימה בסוף). תקרא עם read_document את אלה שנראים רלוונטיים, לפני שאתה מתכנן או שואל. אם קובץ לא נקרא (למשל סריקה בלי טקסט), תגיד לי במשפט אחד.`
    );
  }
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
    `3. רק אחרי שכתבתי במפורש שאני מאשר, תשמור את התוכנית במערכת עם save_task_plan: taskId "${input.taskId}", הטקסט המלא ב-plan, כותרות השלבים ב-steps, approved: true, ו-baseVersion: ${baseVersion}. אם אני מבקש לשמור בלי לאשר, approved: false. משימה פתוחה עוברת ל"בביצוע" אוטומטית כשהתוכנית מאושרת (taskStarted בתשובה). אל תשאל על זה, רק תגיד לי, בתוך השאלה של הכרטיס הבא או כשורה ראשונה אם אין כרטיס.`,
    input.steps.length === 0
      ? "4. למשימה אין עדיין שלבים, ולכן כשתשמור תוכנית מאושרת, השלבים שלה נוספים למשימה אוטומטית. אל תשאל על זה. רק תגיד לי שהשלבים נוספו, באותו מקום שבו אתה מדווח על המעבר ל\"בביצוע\"."
      : "4. למשימה כבר יש שלבים. אחרי השמירה, תשאל אם להחליף את השלבים הפתוחים בשלבי התוכנית (apply_task_plan_steps). תגיד לי ששלבים שבוצעו או שדווח עליהם זמן נשארים.",
    "5. אם אבקש לבצע, תעבוד שלב אחרי שלב לפי התוכנית. כשמסתיים שלב: תסמן אותו עם set_task_step, ותוסיף הערה קצרה במשימה (add_task_comment) על מה נעשה ומה יצא, כדי שמי שיפתח את המשימה אחריי יבין איפה היא עומדת.",
    ""
  );

  out.push(...timerRules(input, "advance"));
  out.push(...HOW_TO_ASK);
  if (input.sources) out.push(...sourcesRules(input, input.sources));

  // ---- What may be done without asking -----------------------------------
  out.push(
    "## מה מותר בלי לשאול, ומה לא",
    "- בלי לשאול: לקרוא נתונים, לחקור, לנסח טיוטות, להוסיף הערה פנימית במשימה (add_task_comment) ולסמן שלב שהסתיים.",
    "- רק אחרי אישור שלי: לסגור את המשימה, לשנות אחראי, תאריך יעד או עדיפות, לדווח זמן, לפתוח החלטה ללקוח, וכל דבר שהלקוח רואה.",
    "- החלטה שהלקוח צריך לקבל: אחרי אישור שלי, אפשר לפתוח אותה בפורטל שלו עם create_decision ולקשר אותה למשימה עם taskId. הלקוח לא מקבל הודעה אוטומטית, אז תזכיר לי לעדכן אותו.",
    `- מסמך שנוצר או נחתם במהלך העבודה: אחרי אישור שלי, לתייק אותו בתיק הלקוח ולקשר למשימה (taskId "${input.taskId}"). אם אתה יכול להריץ פקודות, עם start_document_upload ו-curl. אחרת עם upload_document, עד 1MB. מסמך שתויק מוסתר מהלקוח, אלא אם ביקשתי במפורש שיראה אותו. נוהל הוא חריג, בסעיף הבא.`,
    // 19.10.2026: a procedure filed as a document only was found in the
    // client file only after someone asked. See lib/procedure-to-file.ts.
    `- נוהל, תהליך או כלל קבוע שנוצר במשימה: לפני סגירת המשימה, לתייק אותו כ-PDF עם kind: PROCEDURE ולקשר למשימה. את זה מותר בלי לשאול, והמסמך מוסתר מהלקוח. אחר כך להציע אותו לתיק הלקוח עם propose_knowledge: התהליך עצמו כ-PROCESS, ולפי הצורך גם SYSTEM, REQUEST_TYPE או POLICY. המקור הוא המסמך שתויק (newSource מסוג ANKORA_DOCUMENT עם ה-documentId שלו). ההצעות ממתינות לאישור במסך הבדיקה, ולכן מותר לשלוח אותן בלי לשאול. אחר כך להזכיר לי לאשר.`,
    ...(input.mapping
      ? [
          `- המשימה בשלב מיפוי וצפייה: לפני הסגירה, להציע לתיק הלקוח עם propose_knowledge את מה שנלמד בה (מערכות, אנשי קשר, סוגי בקשות, כללים), גם אם לא נוצר מסמך. המקור הוא המשימה עצמה (newSource מסוג TASK עם taskId "${input.taskId}"), או המסמך שתויק אם יש. מותר בלי לשאול, ואחר כך להזכיר לי לאשר.`,
        ]
      : []),
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
    input.sources
      ? "- **מה ידוע**: שורה ראשונה \"מקורות:\" (על מה התוכנית מבוססת, ומה לא היה זמין), ואז התמצית מהנתונים, בלי לחזור על כולם."
      : "- **מה ידוע**: התמצית מהנתונים, בלי לחזור על כולם.",
    "- **מה חסר**: שאלות פתוחות שצריך לענות עליהן. אם אין, לכתוב \"אין\".",
    "- **שלבים**: רשימה ממוספרת. לכל שלב: מה עושים, מי מבצע (קלוד, שם מנהל התפעול, הלקוח או ספק), במה הוא תלוי, וזמן משוער.",
    `  אם תוצאת המשימה היא נוהל, השלב שלפני הסגירה הוא תמיד: "${PROPOSE_STEP_TITLE}". מבצע: קלוד. אישור: מנהל במסך הבדיקה.`,
    ...(input.mapping
      ? [`  במשימת מיפוי, השלב שלפני הסגירה הוא תמיד: "${PROPOSE_MAPPING_STEP_TITLE}". מבצע: קלוד. אישור: מנהל במסך הבדיקה.`]
      : []),
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
    `מסמכים נוספים בתיק הלקוח, שלא צורפו למשימה: list_documents עם client "${input.clientName}".`,
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

  if (input.files.length > 0) {
    out.push("### קבצים מצורפים");
    out.push("התוכן שלהם לא כלול כאן. לקריאה: read_document עם ה-documentId.");
    for (const f of input.files) {
      const meta = [f.typeLabel, f.sizeLabel, f.atLabel, f.by, f.clientVisible ? "גלוי ללקוח" : "פנימי"].filter(Boolean).join(", ");
      out.push(`- ${f.title} (${meta}). documentId: ${f.documentId}`);
    }
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
    ...(input.files.length > 0 ? ["אם קובץ מצורף רלוונטי לסיכום, אפשר לקרוא אותו עם read_document."] : []),
    "4. אם עולה לקח שכדאי להפוך לנוהל או לשלבים קבועים במשימות דומות, תציע אותו בנפרד בסוף. אל תשנה שום דבר אחר במשימה, ואל תפתח אותה מחדש.",
    ...(input.process
      ? [
          `5. המשימה היא ריצה של התהליך ${input.process.code} ${input.process.title}. תשאל אותי: האם משהו בנוהל לא היה נכון או חסר? אחרי שאישרתי את הנוסח במפורש, תשמור את התשובה עם record_run_lesson: taskId "${input.taskId}", ו-lesson עם מה שלא היה נכון, או nothing: true אם הנוהל היה נכון. זה מגיע לבעלים של התהליך, ולא משנה את הנוהל בעצמו.`,
        ]
      : []),
    "",
    ...timerRules(input, "lessons"),
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

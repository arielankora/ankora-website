// "חלץ ידע עם קלוד" (claude/org-brain-spec-2026-10-12.md, 4 and 5.1): the
// prompt behind the button on the client screen.
//
// Pure and free of project imports, the same convention as
// lib/advance-prompt.ts. The page gathers what the person pressing the
// button may see, in the version for Claude (no contact details, nothing
// sensitive), and hands it here.
//
// The extraction rules are written here, once, for every client (decision
// 3 splits them: what the server enforces stays in code, what guides
// Claude lives in the prompt). The server still refuses what it must:
// a missing source, a secret, a quote from a topics-only source.
//
// Written in Hebrew because the conversation it starts is in Hebrew. Tool
// names, ids and field values stay as they are.

export type ExtractPromptItem = { id: string; label: string; text: string };

export type ExtractPromptSource = {
  code: string;
  title: string;
  dateLabel: string | null;
  kindLabel: string;
  firefliesId: string | null;
  topicsOnly: boolean;
};

export type ExtractPromptInput = {
  requestedBy: string;
  clientName: string;
  /// Facts in the file, with ids, so a change can name what it changes.
  facts: ExtractPromptItem[];
  /// People, organizations and systems, by name only.
  people: string[];
  organizations: string[];
  systems: string[];
  requestTypes?: string[];
  /// The client's rules, by title.
  policies?: string[];
  /// The client's own rules about what may enter its file (spec 3.11).
  /// They bind this extraction on top of Ankora's.
  dataHandling?: string[];
  sources: ExtractPromptSource[];
  domains: string[];
  /// A meeting or document the person already chose, if any.
  focus?: string | null;
  /// The approved guidance, when there is one (decision 3).
  guide?: { version: number; body: string } | null;
};

/// A stored guide is one rule per line; bullets typed by habit are
/// dropped so the prompt does not get "- - ".
export function guideLines(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
}

export const DEFAULT_EXTRACTION_GUIDE = (): string => DEFAULT_EXTRACTION_GUIDE_LINES.join("\n");

/// Ankora's extraction guidance as it shipped. The guidance in use is the
/// latest version approved on the "הנחיות החילוץ" screen (decision 3);
/// until one is approved, this is it.
export const DEFAULT_EXTRACTION_GUIDE_LINES = [
  "פריט נכנס רק אם (1) הלקוח או ספק שלו אמר או הראה אותו במפורש, (2) הוא רלוונטי לעבודה עתידית, ו-(3) הוא עוד לא בתיק. כל השאר לא נכנס.",
  'מידע לא ודאי, סותר, או הנחה שלנו: knowledgeStatus "UNCERTAIN", עם toResolve שאומר מה יסגור אותו. "CONFIRMED" רק כשהלקוח או ספק שלו אמר במפורש.',
  "מידע זמני הוא TEMPORARY, עם validUntil (YYYY-MM-DD) או validUntilEvent. החלטה שהתקבלה פעם אחת היא ONE_OFF_DECISION, עם decidedAt ומי החליט.",
  "שאלה שעלתה ולא נענתה היא QUESTION. היא לא משימה. משהו שמישהו צריך לעשות הוא TASK, לא עובדה.",
  "לא נכנסים: שיחת חולין, תקלות טכניות רגעיות, ניחושים, ותנאי ההתקשרות של אנקורה (תעריף, בנק שעות, חוזה).",
  "סיסמה, מפתח, טוקן או מספר כרטיס שנאמרו: לא לכתוב אותם בשום שדה. רק לציין לי שנאמר סוד, כדי שנחליף אותו. השרת מוחק פריט כזה בכל מקרה.",
  'מקור שמסומן "נושאים בלבד": רק הנושאים שעלו, בלי ציטוטים ובלי פרטים.',
  "לא דורסים ולא מכפילים. אם הלקוח שינה משהו שכבר בתיק (עובדה, איש קשר, ארגון, מערכת, סוג פנייה, כלל, ישות או תהליך): action SUPERSEDE עם targetId, ורק השדות שהשתנו. אם מישהו אמר אחרת על פריט ולא ברור מה נכון: action CONTRADICT עם targetId ומה שנאמר. הפניות של הצוות (RAID-002, HND-014, ClickUp) נכנסות ל-externalRefs.",
  "עבודה שחוזרת (שכר כל חודש, תשלום ספקים ב-10 וב-25, תשלום קבלנים, קליטת עובד) היא PROCESS עם השלבים, מי מבצע, מערכות ומאשר. לא עובדה ולא כלל. הכלל שבתוכה (מי מאשר, עד מתי) נשאר POLICY נפרד, והעובדות שמסבירות אותה לא חוזרות על השלבים.",
  "מועד של הלקוח (יום תשלום, דדליין, עזיבה, תחילת ביקורת, אירוע שחוזר) הוא DATE, עם recurrence ותאריך. אם הוא מפעיל תהליך: processName. מועד שאותו רגע הוא גם תנאי זמני (TEMPORARY) נכנס פעמיים: המועד, והמידע.",
  "לכל פריט: at (הדקה בהקלטה, 08:13), reason במשפט אחד, knowledgeStatus, ו-confidence (HIGH, MEDIUM או LOW): עד כמה אתה בטוח. פריט בלי reason או בלי סטטוס נדחה כשהוא מגיע. quote קצר רק כשהוא באמת עוזר.",
];

export function buildExtractPrompt(input: ExtractPromptInput): string {
  const out: string[] = [];
  out.push(
    `אני ${input.requestedBy} מצוות אנקורה. אני רוצה לעדכן את תיק הלקוח של ${input.clientName} ממקור אחד: פגישה מוקלטת או מסמך.`,
    "",
    "אל תכתוב שום דבר למערכת לפני אישור מפורש שלי לטיוטה. גם אחרי שתשלח, שום דבר לא נכנס לתיק עד שמישהו מאשר אותו במסך \"ממתין לאישור\" באנקורה.",
    "",
    "## איך עובדים",
    "",
    input.focus
      ? `1. המקור: ${input.focus}. קרא אותו (Fireflies להקלטה, read_document למסמך בתיק).`
      : "1. שאל אותי מה המקור. אם זו הקלטה, חפש אותה ב-Fireflies לפי התאריך והכותרת והראה לי מה מצאת לפני שאתה קורא. אם זה מסמך, list_documents ו-read_document.",
    "2. קרא את התיק הנוכחי עם get_client_file, כדי לא להציע מה שכבר שם. כל פריט שם מסתיים ב-(id: ...), וזה ה-targetId לעדכון שלו.",
    "3. הכן טיוטה: טבלה עם סוג הפריט, הטקסט, הסטטוס המוצע, הדקה והסיבה. סמן מה סותר או מחליף פריט קיים.",
    "   כלל שהלקוח קבע (מה מותר, מה אסור, מי מאשר, מה לא מספרים למי) הוא target POLICY. בכלל שמתיר משהו (סף, אישור) כתוב גם interimStatement: מה עושים עד שמנהל מאשר אותו.",
    "   משהו שמישהו צריך לעשות (לשלוח מסמך, לתאם שיחה, לבדוק משהו שהובטח) הוא לא ידע לתיק: target TASK עם title שהוא פעולה, ואם נאמר גם description, dueDate, assigneeName ו-priority. אישור פותח משימה על הלקוח, והיא לא נכנסת לתיק. מה שאותו רגע מלמד על הלקוח (העדפה, כלל) הוא פריט נפרד. משימה גלויה לכל מי שעובד על הלקוח, ולכן שום דבר רגיש לא נכנס אליה.",
    "   מועד (יום תשלום, דדליין, אירוע שחוזר) הוא target DATE: title, recurrence (ONCE, ANNUAL, MONTHLY, WEEKLY) ו-date, dayOfMonth או weekday, ואם נאמר גם processName, responsibleName ו-taskDaysBefore. עבודה שחוזרת היא target PROCESS, לא עובדה.",
    "   מידע רפואי, פוליטי או אישי, או כל מה שכללי הלקוח מגדירים רגיש: sensitivity \"SENSITIVE\". רק מי שמאשר מידע רגיש אצל הלקוח יראה את הפריט ויחליט עליו.",
    "4. אחרי ההערות שלי, אתה מעדכן את הטיוטה.",
    `5. אחרי אישור שלי: propose_knowledge עם client "${input.clientName}", והמקור (sourceCode אם הוא כבר במרשם, אחרת newSource עם firefliesId או documentId).`,
    "6. תגיד לי כמה הצעות נשלחו ומה נשמט, ושהן מחכות לאישור במסך.",
    "",
    "## כללי החילוץ של אנקורה",
    "",
    ...(input.guide ? guideLines(input.guide.body) : DEFAULT_EXTRACTION_GUIDE_LINES).map((r) => `- ${r}`),
    input.guide ? `(הנחיות גרסה ${input.guide.version})` : "",
    ""
  );

  if (input.dataHandling?.length) {
    out.push(
      `## כללי טיפול במידע של ${input.clientName}`,
      "",
      "הלקוח קבע אותם, והם גוברים על כל מה שלמעלה. מה שהם לא מתירים לא נכנס לטיוטה בכלל, גם לא כהערה.",
      "",
      ...input.dataHandling.map((r) => `- ${r}`),
      ""
    );
  }

  out.push("## מה כבר בתיק", "");
  if (input.facts.length === 0 && input.people.length === 0 && input.organizations.length === 0 && input.systems.length === 0) {
    out.push("התיק עדיין ריק.");
  } else {
    if (input.facts.length) {
      out.push("עובדות (המזהה בסוגריים, ל-targetId):");
      for (const f of input.facts) out.push(`- ${f.label}: ${f.text} (${f.id})`);
    }
    if (input.people.length) out.push(`אנשים: ${input.people.join(", ")}`);
    if (input.organizations.length) out.push(`ספקים ונותני שירות: ${input.organizations.join(", ")}`);
    if (input.systems.length) out.push(`מערכות: ${input.systems.join(", ")}`);
    if (input.requestTypes?.length) out.push(`סוגי פניות: ${input.requestTypes.join(", ")}`);
    if (input.policies?.length) out.push(`כללים של הלקוח: ${input.policies.join(", ")}`);
  }
  out.push("");

  out.push("## מרשם המקורות", "");
  if (input.sources.length === 0) out.push("ריק. המקור שנקרא יירשם כ-S1.");
  for (const s of input.sources) {
    out.push(
      `- ${s.code}: ${s.title} (${[s.kindLabel, s.dateLabel, s.firefliesId ? `Fireflies ${s.firefliesId}` : null, s.topicsOnly ? "נושאים בלבד" : null].filter(Boolean).join(", ")})`
    );
  }
  if (input.domains.length) out.push("", `דומיינים של הלקוח ושותפיו: ${input.domains.join(", ")}`);
  out.push("");
  return out.join("\n");
}

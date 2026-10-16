// The prompts an owner pastes into Claude to have the onboarding or
// offboarding of one employee run to the end. Pure text builders, so they
// can be tested and refined without a database. The wording is Ariel's
// from the procedure; only names, ids, dates, links and the version code
// are substituted. Keep them
// faithful: the agent that refines them later works from this file.

export const PROCEDURE_DOC_URL = "https://claude.ai/code/artifact/771a9af2-6b29-4dd8-8bec-ed61ba26b967";

/// The prompt for the onboarding agent. `code` is the Latin code of the
/// current confidentiality version (agreementCode in lib/agreements.ts),
/// passed in rather than written here so a new version cannot leave an
/// old code in a prompt; this file stays free of imports for its tests.
///
/// It names no person as its author: the task can be reassigned, and a
/// prompt that says "I am Hadas" stays wrong after it is (16.10.2026).
///
/// The signed PDF comes back through a personal upload link, not as a
/// reply: the Gmail connector cannot download attachments, so a reply
/// with the PDF could never be filed. The link goes in as a real <a href>
/// in htmlBody, because plain URLs in the dry run came out rewritten as
/// google.com redirects. The connector also cannot choose the sender, so
/// the person sending switches the draft to ops@ before sending.
export function onboardingPrompt(input: {
  employeeName: string;
  employeeEmail: string;
  userId: string;
  taskId: string;
  code: string;
}): string {
  return `אני מצוות אנקורה. תנהל את קליטת ${input.employeeName} (${input.employeeEmail}) עד הסוף, לפי נוהל הקליטה והעזיבה: ${PROCEDURE_DOC_URL}
העובד: userId "${input.userId}". משימת הקליטה: taskId "${input.taskId}". תזהה אותם תמיד לפי המזהים האלה, לא לפי שם.

עכשיו, פעם אחת:
1. תיצור משימה מתוזמנת שרצה בכל יום עסקים ב-09:00 ומבצעת את "בכל ריצה" שלמטה. כשמשימת הקליטה נסגרת, היא מבטלת את עצמה.
2. תוריד את הטופס עם get_blank_agreement_pdf (CONFIDENTIALITY), ותיצור קישור אישי להעלאה עם issue_agreement_upload_link (CONFIDENTIALITY, עם ה-userId). תנסח טיוטת מייל לעובד, עם הטופס מצורף ועם הקישור האישי כקישור אמיתי בגוף המייל (htmlBody עם <a href>, לא כתובת גלויה): לקרוא, לחתום (חתימה דיגיטלית, או מודפס, חתום וסרוק) ולהעלות את ה-PDF החתום בקישור, לא לשלוח אותו בתשובה. החיבור ל-Gmail לא בוחר שולח, ולכן מי ששולח מחליף את השולח ל-ops@ankora.co.il לפני השליחה. תציג לי את הטיוטה, ותשלח רק אחרי אישור שלי. את הקישור לא לשים בשום מקום אחר.

בכל ריצה:
3. get_employee_status עם ה-userId, כדי לדעת מה כבר קיים.
4. לכל מסמך ב-pendingPdfUploads: תקרא אותו עם read_document ותוודא שני דברים: שהקוד ${input.code} מופיע בכותרת התחתונה, ושיש שם וחתימה גלויה (כשהטקסט לא מראה את החתימה, תוריד את הקובץ ותסתכל בעמוד החתימה). אם שניהם קיימים: תרשום אותו עם record_pdf_signature עם ה-documentId הזה. אם משהו לא ברור: הערה במשימה לבדיקה שלי, ולעצור בלי לרשום.
5. האישור במערכת וה-passkey נסגרים לבד כשהעובד מבצע אותם. אם הם חסרים, אין מה לעשות מלבד לעקוב.
6. ביום העסקים השני בלי שתי החתימות: תנסח תזכורת לעובד ותציג לי לפני שליחה. ביום העסקים השלישי: הערה במשימה ועדכון אליי.
7. כששתי החתימות קיימות: תזכיר לי את הגישות לכלים, את השיוך ללקוחות ואת ההדרכה, ותסמן כל שלב רק אחרי שאישרתי שבוצע.
8. כל שלב שהסתיים: הערה קצרה במשימה, מה נעשה ומה יצא.

גבולות: לא לשלוח שום דבר בלי אישור שלי. לא לשייך את העובד ללקוחות. לא לרשום PDF שלא נבדק.`;
}

/// The prompt for the offboarding agent. `code` is the Latin code of the
/// current deletion declaration; `deadline` the DPA date as dd.mm.yyyy;
/// `adminUrl` the absolute address of the person's page in Ankora. Same
/// upload link and sender notes as onboarding above.
export function offboardingPrompt(input: {
  employeeName: string;
  userId: string;
  taskId: string;
  code: string;
  deadline: string;
  adminUrl: string;
}): string {
  return `אני מצוות אנקורה. תנהל את עזיבת ${input.employeeName} עד הסוף, לפי נוהל הקליטה והעזיבה (${PROCEDURE_DOC_URL}) ולפי ה-DPA.
העובד: userId "${input.userId}". משימת העזיבה: taskId "${input.taskId}". כל הגישות חייבות להתבטל עד ${input.deadline}.

עכשיו, פעם אחת:
1. תיצור משימה מתוזמנת שרצה בכל יום עסקים ב-09:00 ומבצעת את "בכל ריצה" שלמטה. כשמשימת העזיבה נסגרת, היא מבטלת את עצמה.
2. תוריד את הצהרת המחיקה עם get_blank_agreement_pdf (DELETION_DECLARATION), ותיצור קישור אישי להעלאה עם issue_agreement_upload_link (DELETION_DECLARATION, עם ה-userId). תנסח טיוטת מייל למייל הפרטי של העובד, עם ההצהרה מצורפת ועם הקישור האישי כקישור אמיתי בגוף המייל (htmlBody עם <a href>, לא כתובת גלויה): לחתום ולהעלות את ה-PDF החתום בקישור, לא לשלוח אותו בתשובה. תזכיר לי לשלוח גם את קישור החתימה מדף המשתמש. החיבור ל-Gmail לא בוחר שולח, ולכן מי ששולח מחליף את השולח ל-ops@ankora.co.il לפני השליחה. תציג לי את הטיוטה לפני שליחה. את הקישור לא לשים בשום מקום אחר.
3. תפיק את דוח הגישות שנצפו ב-90 הימים האחרונים מדף המשתמש (${input.adminUrl}), או תבקש ממני להפיק אותו. לכל לקוח שהעובד צפה בגישות שלו: טיוטת מייל עם הדוח והמלצה להחליף את הגישות האלה. אני שולח, לא אתה.

בכל ריצה:
4. get_employee_status עם ה-userId: אילו שלבים פתוחים ואילו חתימות קיימות.
5. לכל מסמך ב-pendingPdfUploads: תקרא אותו עם read_document. אם הקוד ${input.code} מופיע בכותרת התחתונה ויש שם וחתימה גלויה (כשהטקסט לא מראה את החתימה, תוריד את הקובץ ותסתכל בעמוד החתימה): תרשום עם record_pdf_signature עם ה-documentId הזה. אם משהו לא ברור: הערה במשימה לבדיקה שלי, ולעצור בלי לרשום.
6. ביום העסקים השלישי (${input.deadline}): תשלח לי רשימה של כל גישה שעוד לא סומנה כמבוטלת.
7. כל שלב שהסתיים: הערה קצרה במשימה.

גבולות: לא לשלוח שום דבר ללקוח או לעובד בלי אישור שלי. לסמן שלב רק אחרי שאישרתי שבוצע. לא לרשום PDF שלא נבדק.`;
}

export const ONBOARDING_STEPS = [
  "פתיחת משתמש באפליקציה ואיסוף מייל פרטי",
  "העתקת פרומט הקליטה לקלוד והפעלת הסוכן",
  "מייל לעובד עם ההתחייבות לסודיות כ-PDF לחתימה",
  "אישור ההתחייבות באפליקציה והגדרת passkey",
  "קבלת ה-PDF החתום, בדיקת גרסה ותיוק",
  "מתן גישות לכלים לפי התפקיד ורישומן במשימה",
  "שיוך ללקוחות באפליקציה (רק אחרי שתי החתימות)",
  "הדרכה: ספר הנהלים, אבטחת מידע, קלוד בחשבון הארגוני, כספת הגישות ודיווח שעות",
  "בדיקה שכל השלבים סגורים וסגירת המשימה",
] as const;

/// Index into ONBOARDING_STEPS of the step the system closes when the
/// confidentiality undertaking is signed in the app.
export const ONBOARDING_SIGN_STEP = 3;

/// Index of the step closed when the signed confidentiality PDF is
/// recorded and the in-app signature also exists.
export const ONBOARDING_PDF_STEP = 4;

export const OFFBOARDING_STEPS = [
  "השעיה באפליקציה: ניתוק התחברויות, הסרת passkeys וסגירת חלון האימות",
  "השעיה ב-Google Workspace והעברת בעלות על קבצים",
  "ביטול גישה בשאר הכלים לפי רשימת המערכות",
  "העברת משימות פתוחות וטיימרים, והסרת שיוך מלקוחות",
  "הפקת דוח גישות שנצפו (90 יום) וטיוטה לכל לקוח",
  "שליחת הדוח ללקוחות עם המלצה להחליף סיסמאות",
  "שליחת הצהרת מחיקה בקישור וב-PDF למייל הפרטי",
  "החזרת ציוד, מפתחות ומסמכים",
  "תיוק ההצהרה החתומה, בדיקה שכל השלבים סגורים וסגירת המשימה",
] as const;

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "מנהל/ת על",
  ANKORA_ADMIN: "מנהל/ת Ankora",
  ANKORA_EMPLOYEE: "עובד/ת Ankora",
};

const PROMPT_LEAD = "מומלץ להעתיק את הפרומט לקלוד (בחשבון הארגוני), והוא ינהל את הקליטה עד הסוף.";
const OFFBOARDING_PROMPT_LEAD = "מומלץ להעתיק את הפרומט לקלוד (בחשבון הארגוני), והוא ינהל את העזיבה עד הסוף.";

/// The onboarding task's description. Built after the task exists,
/// because the prompt inside it names the task's own id.
export function onboardingDescription(input: {
  employeeName: string;
  role: string;
  workEmail: string;
  hasPersonalEmail: boolean;
  prompt: string;
}): string {
  return [
    `קליטה של ${input.employeeName} לאנקורה. המשימה מרכזת את כל מה שצריך לקרות עד שהעובד/ת עובד/ת עם לקוחות: שתי חתימות על ההתחייבות לסודיות (באפליקציה וב-PDF), גישות לכלים, שיוך ללקוחות והדרכה. השיוך ללקוחות מחכה לשתי החתימות.`,
    "",
    `- **שם:** ${input.employeeName}`,
    `- **תפקיד:** ${ROLE_LABEL[input.role] ?? input.role}`,
    `- **מייל עבודה:** ${input.workEmail}`,
    `- **מייל פרטי:** ${input.hasPersonalEmail ? "קיים במערכת" : "חסר. יש להוסיף אותו בעמוד המשתמש"}`,
    `- **נוהל:** [נוהל הקליטה והעזיבה](${PROCEDURE_DOC_URL})`,
    "",
    "**פרומט לקלוד**",
    "",
    PROMPT_LEAD,
    "",
    "```",
    input.prompt,
    "```",
  ].join("\n");
}

export function offboardingDescription(input: {
  employeeName: string;
  role: string;
  workEmail: string;
  personalEmail: string | null;
  deadline: string;
  userPageUrl: string;
  clientNames: string[];
  prompt: string;
}): string {
  return [
    `עזיבה של ${input.employeeName}. לפי ה-DPA, כל הגישות של העובד/ת לנתוני לקוחות מבוטלות תוך שלושה ימי עסקים מההשעיה, כלומר עד ${input.deadline}. הגישה לאפליקציה כבר בוטלה אוטומטית. המשימה מרכזת את השאר: כלים חיצוניים, העברת עבודה, דוח גישות ללקוחות, הצהרת מחיקה והחזרת ציוד.`,
    "",
    `- **שם:** ${input.employeeName}`,
    `- **תפקיד:** ${ROLE_LABEL[input.role] ?? input.role}`,
    `- **מייל עבודה:** ${input.workEmail}`,
    `- **מייל פרטי:** ${input.personalEmail ?? "חסר. יש להוסיף אותו בעמוד המשתמש לפני שליחת הצהרת המחיקה"}`,
    `- **מועד אחרון לביטול גישות:** ${input.deadline}`,
    `- **לקוחות משויכים:** ${input.clientNames.length ? input.clientNames.join(", ") : "אין"}`,
    `- **עמוד המשתמש:** [פתיחה](${input.userPageUrl})`,
    `- **נוהל:** [נוהל הקליטה והעזיבה](${PROCEDURE_DOC_URL})`,
    "",
    "**פרומט לקלוד**",
    "",
    OFFBOARDING_PROMPT_LEAD,
    "",
    "```",
    input.prompt,
    "```",
  ].join("\n");
}

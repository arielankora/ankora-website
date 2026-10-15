// The prompts an owner pastes into Claude to have the onboarding or
// offboarding of one employee run to the end. Pure text builders, so they
// can be tested and refined without a database. The wording is Ariel's
// from the procedure; only names, ids and dates are substituted. Keep them
// faithful: the agent that refines them later works from this file.

export const PROCEDURE_DOC_URL = "https://claude.ai/code/artifact/771a9af2-6b29-4dd8-8bec-ed61ba26b967";

export function onboardingPrompt(input: {
  ownerName: string;
  employeeName: string;
  employeeEmail: string;
  taskId: string;
}): string {
  return [
    `אני ${input.ownerName} מאנקורה. תנהל את קליטת העובד/ת ${input.employeeName} (${input.employeeEmail}) עד הסוף, לפי נוהל הקליטה והעזיבה.`,
    `משימת הקליטה: taskId "${input.taskId}". תזהה אותה תמיד לפי ה-taskId.`,
    "1. תיצור משימה מתוזמנת שרצה כל יום עסקים ב-09:00 ובודקת את מצב הקליטה, עד שהמשימה נסגרת.",
    "2. בריצה הראשונה: תנסח מייל מ-ops@ankora.co.il לעובד עם ההתחייבות לסודיות כ-PDF לחתימה, ותבקש שיחזיר אותו חתום באותו שרשור. תציג לי את הטיוטה לפני שליחה.",
    "3. בכל ריצה: תבדוק אם ה-PDF החתום חזר, ואם מספר הגרסה בו תואם לגרסה הנוכחית ויש חתימה. אם כן, תתייק אותו בתיק Ankora פנימי עם קישור למשימה ותסמן את השלב. אם משהו לא ברור, תסמן אותו לבדיקה אנושית ולא תתייק.",
    "4. תבדוק בחיבור של אנקורה שהאישור במערכת קיים, ותסמן את השלב.",
    "5. ביום העסקים השני בלי שתי החתימות: תזכורת לעובד. ביום השלישי: עדכון לבעלת המשימה.",
    "6. כל שלב שהסתיים: הערה קצרה במשימה.",
    "אל תשלח שום דבר בלי אישור שלי, ואל תשייך את העובד ללקוחות לפני ששתי החתימות קיימות.",
  ].join("\n");
}

export function offboardingPrompt(input: {
  ownerName: string;
  employeeName: string;
  taskId: string;
  /// The DPA deadline, already formatted for reading (e.g. "20.10.2026").
  deadline: string;
}): string {
  return [
    `אני ${input.ownerName} מאנקורה. תנהל את עזיבת העובד/ת ${input.employeeName} עד הסוף, לפי נוהל הקליטה והעזיבה ולפי ה-DPA.`,
    `משימת העזיבה: taskId "${input.taskId}". המועד לביטול כל הגישות: ${input.deadline}.`,
    "1. תיצור משימה מתוזמנת שרצה כל יום עסקים ב-09:00 עד שהמשימה נסגרת.",
    "2. תכין לכל לקוח שהעובד צפה בגישות שלו טיוטת מייל עם דוח הגישות שנצפו ב-90 הימים האחרונים והמלצה להחליף אותן. אני שולח, לא אתה.",
    "3. תנסח מייל מ-ops@ankora.co.il למייל הפרטי של העובד עם הצהרת המחיקה כ-PDF, ותציג לי לפני שליחה. תעקוב עד שה-PDF החתום חוזר ותתייק אותו בתיק Ankora פנימי.",
    "4. תבדוק כל שלב, ותזכיר לי ביום העסקים השלישי על כל גישה שעוד לא בוטלה.",
    "5. כל שלב שהסתיים: הערה קצרה במשימה.",
    "אל תשלח שום דבר ללקוח או לעובד בלי אישור שלי.",
  ].join("\n");
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

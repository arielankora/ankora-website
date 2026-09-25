import "server-only";

// Tasks phase 5: the procedures from the SOP book, as steps.
//
// The company has a ספר נהלים. It says, in real detail, what to do when
// a client stops answering, when somebody makes a mistake, when a
// project is cancelled. It is a good document, and like every good
// document of its kind it is read once, when somebody joins.
//
// A procedure that lives in a document is a procedure people follow from
// memory. A procedure that arrives as five lines inside the task they
// already have open is a procedure people follow.
//
// That is the whole of this file: the book's own steps, in the book's
// own order, applied to a task in one click.
//
// ---
//
// **Why these live in code and not in a table with a screen to edit
// them.** It looks like the obvious thing to make editable, and it is
// the wrong one.
//
// The SOP book governs its own changes, and says so: "אין ליישם שינוי
// קבוע לפני שאושר ותועד", and every version records a number, a date,
// who approved it, what changed and why. A template editable from a
// screen has none of that. A template in this file has all of it,
// because a pull request IS a version number, a date, an approver, a
// diff and a reason - and it is reviewed by someone before it reaches
// anybody's work.
//
// The cost is honest: changing a template needs a developer. If that
// becomes the thing that stops the book from being used, a table is the
// answer and this file becomes its seed. Until then, the coupling
// between "the book changed" and "the product changed" is a feature, and
// `sopSection` below is what keeps the two readable against each other.

export type TemplateStep = {
  title: string;
  /// Days from today, in Israel time, for this step's deadline.
  ///
  /// Several of the book's procedures ARE a schedule: the reminders to a
  /// silent client are at 24 hours, 3 days and 7 days, and a ladder
  /// without its rungs is just a list of the same sentence three times.
  /// This is the difference between a checklist and a procedure.
  dueInDays?: number;
};

export type TaskTemplate = {
  id: string;
  name: string;
  /// One line on the screen, under the name: when a person would reach
  /// for this. Not a summary of the steps, which they are about to see.
  when: string;
  /// The chapter in the SOP book this came from, so the two can be read
  /// against each other when either changes.
  sopSection: string;
  steps: TemplateStep[];
};

/// Seven procedures, each copied from the book rather than summarised.
///
/// Where the book gives a sequence, the steps are that sequence. Where
/// it gives a question to answer, the step is the question: "האם זה
/// תיקון, תוספת או פרויקט חדש" is one step, because it is one decision,
/// and splitting it into three would make somebody tick two boxes that
/// are not true.
export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "client-silent",
    name: "לקוח שלא מגיב",
    when: "אחרי שנשלחה בקשה למידע ואין תשובה",
    sopSection: "טיפול בחריגים, סעיף 1",
    steps: [
      { title: "תזכורת ראשונה ללקוח", dueInDays: 1 },
      { title: "תזכורת שנייה ללקוח", dueInDays: 3 },
      { title: "תזכורת אחרונה ללקוח", dueInDays: 7 },
      // The book's own consequence, and the reason this template is
      // worth having at all: the ladder ends somewhere, and the ending
      // is a decision about the project rather than another message.
      { title: "העברה למצב ממתין ללקוח והקפאת לוחות הזמנים", dueInDays: 8 },
    ],
  },
  {
    id: "mistake",
    name: "טעות שהתגלתה",
    when: "כשנמצאה טעות בתוצר או בתהליך",
    sopSection: "טיפול בחריגים, סעיף 4",
    steps: [
      { title: "לעצור ולבדוק את היקף הטעות" },
      { title: "לתקן" },
      { title: "לבצע QA מלא מחדש" },
      { title: "לעדכן את הלקוח אם יש בכך צורך" },
      // "המטרה אינה למצוא אשמים אלא לשפר את התהליך", in the book's
      // words. The step is here so that the last thing anybody does is
      // the thing that stops it happening again.
      { title: "לתעד את הסיבה האמיתית כדי למנוע הישנות" },
    ],
  },
  {
    id: "crisis",
    name: "משבר",
    when: "תקלה חמורה, עיכוב משמעותי, או אי שביעות רצון חריגה",
    sopSection: "טיפול בחריגים, סעיף 7",
    steps: [
      // First, and first in the book too: "ממנים אחראי אחד שמנהל את
      // האירוע". A crisis with two owners is a crisis nobody owns.
      { title: "למנות אחראי אחד שמנהל את האירוע" },
      { title: "לאסוף את כל העובדות" },
      { title: "לעדכן את הלקוח באופן יזום" },
      { title: "לבנות תוכנית פעולה" },
      { title: "מעקב עד לסיום מלא" },
      { title: "תחקיר פנימי ועדכון נהלים במידת הצורך" },
    ],
  },
  {
    id: "complaint",
    name: "תלונת לקוח",
    when: "כשלקוח מביע אי שביעות רצון",
    sopSection: "טיפול בחריגים, סעיף 6",
    steps: [
      { title: "להקשיב עד הסוף" },
      { title: "להודות ללקוח על השיתוף" },
      { title: "לבדוק עובדות" },
      { title: "להציע פתרון" },
      // The one people skip, which is why it is a step with a date.
      { title: "מעקב אחרי הפתרון", dueInDays: 7 },
    ],
  },
  {
    id: "scope-change",
    name: "שינוי דרישות באמצע",
    when: "כשהלקוח מבקש משהו שלא סוכם",
    sopSection: "טיפול בחריגים, סעיף 2",
    steps: [
      // One step and not three, because it is one decision. Three boxes
      // would invite somebody to tick two that cannot both be true.
      { title: "להכריע: תיקון, תוספת, או פרויקט חדש" },
      { title: "להסביר ללקוח מה השתנה" },
      { title: "לעדכן זמן ביצוע" },
      { title: "לעדכן מחיר במידת הצורך" },
      { title: "להתחיל רק אחרי אישור" },
    ],
  },
  {
    id: "handover",
    name: "מסירה ללקוח",
    when: "בסיום שירות",
    sopSection: "מסע הלקוח, שלבים 6 ו-7",
    steps: [
      { title: "לרכז מה בוצע, אישורים, קישורים ומסמכים" },
      { title: "לשלוח חשבונית אם רלוונטי" },
      { title: "לכתוב נקודות שחשוב לזכור להמשך" },
      { title: 'לשאול: "יש משהו נוסף שנוכל להוריד ממך?"' },
      // The book puts a number on this one: "כעבור מספר ימים ניצור
      // קשר. לא כדי למכור. כדי לוודא שהכול הסתדר."
      { title: "מעקב אחרי השירות: לוודא שהכול הסתדר", dueInDays: 5 },
    ],
  },
  {
    id: "cancellation",
    name: "ביטול פרויקט",
    when: "כשלקוח מבטל",
    sopSection: "טיפול בחריגים, סעיף 5",
    steps: [
      { title: "לוודא מה כבר בוצע ומה מועבר ללקוח" },
      { title: "להכריע על תשלומים והחזרים מול המדיניות" },
      { title: "לתעד את סיבת הביטול" },
      { title: "לשמור את כל החומרים לפי מדיניות החברה" },
    ],
  },
];

export function findTemplate(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.id === id);
}

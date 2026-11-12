import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import he from "../../messages/he.json";
import en from "../../messages/en.json";
import { DUPLICATE_MESSAGES, proposalProblems, type ProposalFlag } from "@/lib/knowledge-proposals";
import { flagText, flagWordsRenderer, storedFlagSay, type RootT } from "@/lib/knowledge-flag-words";
import { processProposalFlagMessage } from "@/lib/procedure-approval";
import { procedurePreview, type PreviewCheck } from "@/lib/approvals-preview";
import { readSteps } from "@/lib/process-rules";
import { procedureWords, type LooseT } from "@/app/(product)/app/(authenticated)/approvals/procedure-words";

/**
 * ADR 0006. A proposal's flags are stored as Hebrew sentences that Claude
 * reads, and the review card words them from keys. The Hebrew the keys
 * give must be the sentence itself, character for character, or a Hebrew
 * reader would see the card change; and every sentence the writers store
 * must be recognised, or an English reader would see Hebrew.
 */

const root = (messages: typeof he, locale: "he-IL" | "en-IL") => createTranslator({ locale, messages }) as unknown as RootT;
const heRender = flagWordsRenderer(root(he, "he-IL"));
const enRender = flagWordsRenderer(root(en, "en-IL"));
const HEBREW = /\p{Script=Hebrew}/u;

describe("stored proposal flags (ADR 0006)", () => {
  const stored: Pick<ProposalFlag, "code" | "message" | "match">[] = [
    { code: "R14", message: "המקור הוא מסמך של אנקורה, ולכן הפריט יישמר כלא ודאי." },
    { code: "R6", message: "מידע רגיש: רק מי שמאשר מידע רגיש אצל הלקוח רואה את הפריט ומחליט עליו." },
    { code: "POLICY", message: "באישור, הכלל נכנס לתיק כמוצע. מנהל מאשר אותו בנפרד כדי שייכנס לתוקף." },
    { code: "NARRATIVE", message: "באישור, הטקסט הזה מחליף את הגרסה שבתיק (הקודמת נשמרת בהיסטוריה)." },
    { code: "NARRATIVE", message: "באישור, זו הגרסה הראשונה של הטקסט." },
    { code: "DUPLICATE", message: "זה כבר הטקסט שבתיק." },
    { code: "DUPLICATE", message: "הפריט כבר בתיק." },
    ...Object.values(DUPLICATE_MESSAGES).map((message) => ({ code: "DUPLICATE", message })),
    ...(["draft", "combined", "separation"] as const).map((mode) => ({ code: "PROCESS", message: processProposalFlagMessage(mode) })),
    { code: "OWNER", message: 'אין איש צוות אחד בשם "דנה". הפריט ייכנס בלי בעלים, אלא אם מתקנים את השם.' },
    { code: "OWNER", message: 'אין איש צוות אחד בשם "דנה". המשימה תיפתח על מי שמאשר, אלא אם מתקנים את השם.' },
    { code: "OWNER", message: 'אין איש צוות אחד בשם "דנה". האחראי יהיה מי שמאשר, אלא אם מתקנים את השם.' },
    { code: "LINK", message: "לא נמצא בתיק: ספק X; מערכת Y. אם הוא ייכנס לתיק לפני האישור, הוא יקושר. אחרת הפריט ייכנס בלי הקישור הזה." },
    { code: "TASK_TITLE", message: 'הכותרת היא שאלה. באישור המשימה תיפתח כ"לבדוק את החשבונית". אפשר לנסח אחרת בעריכה.' },
    { code: "KIND", message: "הפריט בתיק הוא שאלה פתוחה. באישור, הטקסט הזה נרשם כתשובה שלה והשאלה נסגרת." },
    { code: "KIND", message: "הפריט בתיק הוא העדפה, וההצעה היא דרישה חוזרת. באישור, היא נכנסת כפריט חדש, והפריט שבתיק נשאר." },
    { code: "SIMILAR", match: { id: "a", name: "איילה" }, message: '"איילה" כבר בתיק. אפשר להוסיף את ההצעה אליו במקום פריט שני.' },
    { code: "SIMILAR", match: { id: "a", name: "איילה" }, message: 'ייתכן שזה "איילה" הקיים. אפשר להוסיף את ההצעה אליו במקום פריט חדש.' },
    { code: "SIMILAR", match: { id: "a", name: "יום הולדת" }, message: 'ייתכן שזה "יום הולדת" הקיים: אותו יום, כמעט אותו שם. אם כן, דוחים את ההצעה ומשלימים את המועד הקיים.' },
  ];

  it.each(stored)("$code: is recognised, says the same Hebrew, and has English", (f) => {
    const say = storedFlagSay(f);
    expect(say).not.toBeNull();
    expect(heRender(say!.message)).toBe(f.message);
    // Names and references are content and stay as written; the rest is English.
    const english = enRender(say!.message).replace(/"[^"]*"/g, "").replace(/: .*?\. If it enters/, ": . If it enters");
    expect(english).not.toMatch(HEBREW);
  });

  it("leaves a sentence it does not know as it is", () => {
    const f: ProposalFlag = { code: "OTHER", message: "משפט חדש שאין לו מפתח." };
    expect(flagText(f, enRender).message).toBe(f.message);
  });
});

describe("problems said again on the card (ADR 0006)", () => {
  const cases: [string, Parameters<typeof proposalProblems>][] = [
    ["R17", ["FACT", { kind: "NOTE", body: "ראו [S99] ו-[S98]" }, []]],
    ["R17 one", ["FACT", { kind: "NOTE", body: "ראו [S99]" }, []]],
    ["fact shape", ["FACT", { kind: "TEMPORARY", body: "בחופשה" }, []]],
    ["fact body", ["FACT", { kind: "NOTE", body: "" }, []]],
    ["date shape", ["DATE", { title: "חידוש", recurrence: "ONCE" }, []]],
    ["date without field", ["DATE", { title: "חידוש", recurrence: "WEEKLY" }, []]],
    ["interim", ["POLICY", { kind: "THRESHOLD", statement: "x" }, []]],
    ["toResolve", ["CONTACT", { name: "x", knowledgeStatus: "UNCERTAIN" }, [], { sourceTitle: "פגישה" }]],
    ["visible", ["FACT", { kind: "NOTE", body: "x", clientVisible: true, sensitivity: "SENSITIVE" }, []]],
    [
      "process checks",
      [
        "PROCESS",
        {
          steps: [
            { title: "תשלום", mode: "AUTOMATED", actionTags: ["PAYMENT"] },
            { title: "שליחה", mode: "AUTOMATED" },
            { title: "בדיקה", mode: "AUTOMATED" },
          ],
        },
        [],
      ],
    ],
  ];

  it.each(cases)("%s: every flag has keys whose Hebrew is the message", (_, args) => {
    const flags = proposalProblems(...args);
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) {
      expect(f.say).toBeDefined();
      expect(heRender(f.say!.message)).toBe(f.message);
      if (f.say!.why) expect(heRender(f.say!.why)).toBe(f.why);
      if (f.fix?.say) expect(heRender(f.fix.say)).toBe(f.fix.label);
      expect(enRender(f.say!.message)).not.toMatch(HEBREW);
    }
  });
});

describe("a procedure on the approvals screen (ADR 0006)", () => {
  const tProc = createTranslator({ locale: "he-IL", messages: he, namespace: "clients.processes" }) as unknown as LooseT;
  const tPrev = createTranslator({ locale: "he-IL", messages: he, namespace: "approvals.preview" }) as unknown as LooseT;

  it("words the steps and the failing checks as the Hebrew preview does", () => {
    const steps = readSteps([
      { title: "תשלום לספק", mode: "AUTOMATED", actionTags: ["PAYMENT"], offsetBusinessDays: -2, channel: "EMAIL", requiresApproval: true, output: "קבלה" },
      { title: "שליחה", mode: "AUTOMATED", systemIds: ["s1", "gone"], amountMaxMinor: 50000, currency: "ILS" },
      { title: "בדיקה", mode: "MANUAL", verification: "רואים את הקבלה" },
    ]);
    const checks: PreviewCheck[] = [
      { code: "R1", step: 1, severity: "BLOCK", message: "שלב 1: תשלום לא נעשה אוטומטית. לפי ספר הנהלים זו החלטה של אדם.", keyed: { key: "humanOnlyAutomated", step: 1, tags: ["PAYMENT"] } },
      { code: "R3", step: 1, severity: "BLOCK", message: "שלב 1 אוטומטי: צריך לכתוב איך אדם מוודא שזה קרה.", keyed: { key: "automatedNoVerification", step: 1 } },
      { code: "R3", step: 2, severity: "BLOCK", message: "שלב 2 אוטומטי: צריך לכתוב איך אדם מוודא שזה קרה.", keyed: { key: "automatedNoVerification", step: 2 } },
      { code: "R9", severity: "EXCEPTION", excepted: false, message: "כלל של הלקוח." },
      { code: "R8", severity: "EXCEPTION", excepted: true, message: "כלל אחר של הלקוח." },
    ];
    const systemName = { s1: "פריוריטי" };
    const preview = procedurePreview({ steps }, systemName, checks);
    const words = procedureWords(tProc, tPrev, { steps, systemName, checks });
    expect(words.steps).toEqual(preview.sections.find((s) => s.headingKey === "steps")!.lines);
    expect(words.excepted).toEqual(preview.sections.find((s) => s.headingKey === "excepted")!.lines);
    expect(words.problems).toEqual(preview.problems);
  });
});

import { FACT_KIND_LABELS } from "@/lib/client-facts";
import { DUPLICATE_MESSAGES, type FlagSay, type FlagWords, type FlagWordsValue, type ProposalFlag } from "@/lib/knowledge-proposals";
import { processProposalFlagMessage, type ProcessProposalMode } from "@/lib/procedure-approval";

// ADR 0006: a proposal's flags on the review card, in the reader's
// language.
//
// A flag is stored with its proposal as Hebrew sentences, and Claude reads
// those sentences (propose_knowledge, list_approvals), so they stay as
// they are. The problems a pending card has are said again when it is read
// (proposalProblems), and those carry their words as keys (`say`). The
// rest were stored as sentences only, by the writers in
// lib/app-domain/knowledge-proposals.ts (flagsFor) and proposal-existing.ts;
// storedFlagSay recognises each of those sentences and gives its keys,
// which also covers every proposal stored before keys existed. A sentence
// it does not know is shown as it is.
// tests/unit/knowledge-flag-words.test.ts holds the two sides together.

const k = (key: string, values?: FlagWords["values"]): FlagWords => ({ key: `knowledge.flags.${key}`, ...(values ? { values } : {}) });

const FIXED: Record<string, FlagWords> = {
  "המקור הוא מסמך של אנקורה, ולכן הפריט יישמר כלא ודאי.": k("r14"),
  "מידע רגיש: רק מי שמאשר מידע רגיש אצל הלקוח רואה את הפריט ומחליט עליו.": k("sensitive"),
  "באישור, הכלל נכנס לתיק כמוצע. מנהל מאשר אותו בנפרד כדי שייכנס לתוקף.": k("policy"),
  "באישור, הטקסט הזה מחליף את הגרסה שבתיק (הקודמת נשמרת בהיסטוריה).": k("narrativeReplaces"),
  "באישור, זו הגרסה הראשונה של הטקסט.": k("narrativeFirst"),
  "זה כבר הטקסט שבתיק.": k("duplicate.sameText"),
  "הפריט כבר בתיק.": k("duplicate.other"),
  "הפריט בתיק הוא שאלה פתוחה. באישור, הטקסט הזה נרשם כתשובה שלה והשאלה נסגרת.": k("kindAnswersQuestion"),
  ...Object.fromEntries(Object.entries(DUPLICATE_MESSAGES).map(([target, message]) => [message, k(`duplicate.${target}`)])),
  ...Object.fromEntries((["draft", "combined", "separation"] as ProcessProposalMode[]).map((mode) => [processProposalFlagMessage(mode), k(`process.${mode}`)])),
};

const KIND_BY_LABEL = new Map(Object.entries(FACT_KIND_LABELS).map(([kind, label]) => [label, kind]));
const kindWords = (label: string): FlagWords => {
  const kind = KIND_BY_LABEL.get(label);
  return kind ? { key: `knowledge.factKinds.${kind}` } : k("otherKind");
};

const OWNER = /^אין איש צוות אחד בשם "([\s\S]*)"\. (הפריט ייכנס בלי בעלים|המשימה תיפתח על מי שמאשר|האחראי יהיה מי שמאשר), אלא אם מתקנים את השם\.$/;
const OWNER_KEYS: Record<string, string> = {
  "הפריט ייכנס בלי בעלים": "ownerItem",
  "המשימה תיפתח על מי שמאשר": "ownerTask",
  "האחראי יהיה מי שמאשר": "ownerDate",
};
const LINK = /^לא נמצא בתיק: ([\s\S]*)\. אם הוא ייכנס לתיק לפני האישור, הוא יקושר\. אחרת הפריט ייכנס בלי הקישור הזה\.$/;
const TASK_TITLE = /^הכותרת היא שאלה\. באישור המשימה תיפתח כ"([\s\S]*)"\. אפשר לנסח אחרת בעריכה\.$/;
const KIND = /^הפריט בתיק הוא (.+), וההצעה היא (.+)\. באישור, היא נכנסת כפריט חדש, והפריט שבתיק נשאר\.$/;

/// The keys of a flag as stored, or null when its sentence is not known.
export function storedFlagSay(f: Pick<ProposalFlag, "code" | "message" | "match">): FlagSay | null {
  const fixed = FIXED[f.message];
  if (fixed) return { message: fixed };
  if (f.code === "SIMILAR" && f.match) {
    const name = f.match.name;
    if (f.message === `"${name}" כבר בתיק. אפשר להוסיף את ההצעה אליו במקום פריט שני.`) return { message: k("similarSame", { name }) };
    if (f.message === `ייתכן שזה "${name}" הקיים. אפשר להוסיף את ההצעה אליו במקום פריט חדש.`) return { message: k("similarMaybe", { name }) };
    if (f.message === `ייתכן שזה "${name}" הקיים: אותו יום, כמעט אותו שם. אם כן, דוחים את ההצעה ומשלימים את המועד הקיים.`) return { message: k("similarDate", { name }) };
    return null;
  }
  const owner = f.code === "OWNER" ? OWNER.exec(f.message) : null;
  if (owner) return { message: k(OWNER_KEYS[owner[2]], { name: owner[1] }) };
  const link = f.code === "LINK" ? LINK.exec(f.message) : null;
  if (link) return { message: k("link", { refs: link[1] }) };
  const title = f.code === "TASK_TITLE" ? TASK_TITLE.exec(f.message) : null;
  if (title) return { message: k("taskTitle", { title: title[1] }) };
  const kind = f.code === "KIND" ? KIND.exec(f.message) : null;
  if (kind) return { message: k("kindNewItem", { from: kindWords(kind[1]), to: kindWords(kind[2]) }) };
  return null;
}

/// A translator from the root of the dictionary (getTranslations()).
export type RootT = (key: string, values?: Record<string, string | number>) => string;

/// Resolves a key and the keys inside its values.
export function flagWordsRenderer(t: RootT): (w: FlagWords) => string {
  const value = (v: FlagWordsValue): string | number =>
    typeof v === "string" || typeof v === "number" ? v : "join" in v ? v.join.map((x) => (typeof x === "string" ? x : render(x))).join(", ") : render(v);
  const render = (w: FlagWords): string => t(w.key, Object.fromEntries(Object.entries(w.values ?? {}).map(([name, v]) => [name, value(v)])));
  return render;
}

/// What the card shows for one flag: its sentence and why, and the label
/// of its suggested wording when that label is not itself the wording.
export type FlagText = { message: string; why: string | null; fix: string | null };

export function flagText(f: ProposalFlag, render: (w: FlagWords) => string): FlagText {
  const say = f.say ?? storedFlagSay(f);
  return {
    message: say ? render(say.message) : f.message,
    why: say?.why ? render(say.why) : (f.why ?? null),
    fix: f.fix ? (f.fix.say ? render(f.fix.say) : f.fix.label) : null,
  };
}

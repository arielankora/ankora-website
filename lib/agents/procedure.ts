// Agents (23.11.2026): an agent that carries out an Ankora process gets the
// approved procedure as a section of its instructions. Built at fetch time
// from mcpGetProcess, so a newly approved procedure reaches every
// installation without a new agent version. Pure: no database.

export type LinkedProcedure =
  | {
      ok: true;
      code: string;
      title: string;
      clientName: string;
      version: number;
      steps: { n: number; title: string; output: string | null; verification: string | null; needsApproval: boolean }[];
      highlights: string | null;
      outputs: string | null;
      failsRules: string[];
    }
  | { ok: false; code: string | null; title: string | null; reason: "noApproved" | "noAccess" | "aiExcluded" };

// ADR 0006: the fixed words follow the language of the person running the
// agent. The procedure's own steps and notes are content and stay as written.
const TEXT = {
  he: {
    linked: "התהליך המקושר",
    noApproved: (name: string) => `ל${name} אין עדיין נוהל מאושר.`,
    aiExcluded: (name: string) => `${name} שייך ללקוח שמסומן "בלי AI", ולכן הנוהל לא נשלח.`,
    noAccess: (name: string) => `אין לך גישה ל${name}.`,
    unavailable: (why: string) => `## הנוהל\n\n${why} עבוד לפי ההוראות למעלה בלבד, ודווח על כך בסוף הריצה.\n`,
    title: (code: string, title: string, client: string, version: number) => `## הנוהל: ${code} ${title} (${client}, גרסה ${version})`,
    intro: "הסוכן מבצע את הנוהל המאושר הזה באנקורה. כשהוא סותר את ההוראות למעלה, הנוהל קובע. שלב שמסומן \"באישור אדם\" מחכה לאדם.",
    needsApproval: " (באישור אדם)",
    output: "תוצר",
    verification: "איך יודעים שנעשה",
    highlights: "דגשים",
    outputs: "מה חייב להיות בסוף",
    failsRules: (rules: string) => `שים לב, הנוהל לא עומד היום בכללי הלקוח: ${rules}. אמור את זה לפני שאתה פועל.`,
  },
  en: {
    linked: "the linked process",
    noApproved: (name: string) => `${name} has no approved procedure yet.`,
    aiExcluded: (name: string) => `${name} belongs to a client marked "no AI", so the procedure is not sent.`,
    noAccess: (name: string) => `You have no access to ${name}.`,
    unavailable: (why: string) => `## The procedure\n\n${why} Work by the instructions above only, and report this at the end of the run.\n`,
    title: (code: string, title: string, client: string, version: number) => `## The procedure: ${code} ${title} (${client}, version ${version})`,
    intro: "The agent carries out this approved procedure in Ankora. Where it contradicts the instructions above, the procedure wins. A step marked \"needs a person's approval\" waits for a person.",
    needsApproval: " (needs a person's approval)",
    output: "Output",
    verification: "How to know it is done",
    highlights: "Highlights",
    outputs: "What must exist at the end",
    failsRules: (rules: string) => `Note: the procedure does not meet the client's rules today: ${rules}. Say so before you act.`,
  },
};

export function procedureSection(p: LinkedProcedure, locale: "he" | "en" = "he"): string {
  const w = TEXT[locale];
  if (!p.ok) {
    const name = p.code ? `${p.code} ${p.title ?? ""}`.trim() : w.linked;
    const why = p.reason === "noApproved" ? w.noApproved(name) : p.reason === "aiExcluded" ? w.aiExcluded(name) : w.noAccess(name);
    return w.unavailable(why);
  }
  const lines = [w.title(p.code, p.title, p.clientName, p.version), "", w.intro, ""];
  for (const s of p.steps) {
    lines.push(`${s.n}. ${s.title}${s.needsApproval ? w.needsApproval : ""}`);
    if (s.output) lines.push(`   - ${w.output}: ${s.output}`);
    if (s.verification) lines.push(`   - ${w.verification}: ${s.verification}`);
  }
  if (p.highlights?.trim()) lines.push("", `${w.highlights}: ${p.highlights.trim()}`);
  if (p.outputs?.trim()) lines.push("", `${w.outputs}: ${p.outputs.trim()}`);
  if (p.failsRules.length) lines.push("", w.failsRules(p.failsRules.join("; ")));
  return lines.join("\n") + "\n";
}

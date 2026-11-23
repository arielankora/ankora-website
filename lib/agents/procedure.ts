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

export function procedureSection(p: LinkedProcedure): string {
  if (!p.ok) {
    const name = p.code ? `${p.code} ${p.title ?? ""}`.trim() : "התהליך המקושר";
    const why =
      p.reason === "noApproved"
        ? `ל${name} אין עדיין נוהל מאושר.`
        : p.reason === "aiExcluded"
          ? `${name} שייך ללקוח שמסומן "בלי AI", ולכן הנוהל לא נשלח.`
          : `אין לך גישה ל${name}.`;
    return `## הנוהל\n\n${why} עבוד לפי ההוראות למעלה בלבד, ודווח על כך בסוף הריצה.\n`;
  }
  const lines = [`## הנוהל: ${p.code} ${p.title} (${p.clientName}, גרסה ${p.version})`, "", "הסוכן מבצע את הנוהל המאושר הזה באנקורה. כשהוא סותר את ההוראות למעלה, הנוהל קובע. שלב שמסומן \"באישור אדם\" מחכה לאדם.", ""];
  for (const s of p.steps) {
    lines.push(`${s.n}. ${s.title}${s.needsApproval ? " (באישור אדם)" : ""}`);
    if (s.output) lines.push(`   - תוצר: ${s.output}`);
    if (s.verification) lines.push(`   - איך יודעים שנעשה: ${s.verification}`);
  }
  if (p.highlights?.trim()) lines.push("", `דגשים: ${p.highlights.trim()}`);
  if (p.outputs?.trim()) lines.push("", `מה חייב להיות בסוף: ${p.outputs.trim()}`);
  if (p.failsRules.length) lines.push("", `שים לב, הנוהל לא עומד היום בכללי הלקוח: ${p.failsRules.join("; ")}. אמור את זה לפני שאתה פועל.`);
  return lines.join("\n") + "\n";
}

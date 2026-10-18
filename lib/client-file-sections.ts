// Pieces of the client file that are built from work already done rather
// than kept by hand (claude/org-brain-spec-2026-10-12.md, 6.1): one-off
// suppliers from tasks (7.2), the batches that came from the extraction
// (16), and which rules sit where (6, 8, 9, 14). Pure, so the read view,
// the Markdown, the PDF and the tests agree.

import type { SupplierExperience } from "@prisma/client";
import type { DocItem } from "@/lib/client-file-document";
import { SUPPLIER_EXPERIENCE_LABELS } from "@/lib/app-domain/portal-labels";

/// Rules read with the section they belong to, not all in section 6: a
/// threshold or an approval is read with the money (8), a channel rule
/// with the channels (9), a working or data-handling rule with the
/// working rules (14).
export function ruleSection(kind: string): "6" | "8" | "9" | "14" {
  if (kind === "THRESHOLD" || kind === "APPROVAL_REQUIRED") return "8";
  if (kind === "COMMUNICATION") return "9";
  if (kind === "INFO" || kind === "DATA_HANDLING") return "14";
  return "6";
}

export const ONE_OFF_GROUP = "ספקים חד-פעמיים, מתוך משימות";
export const BATCH_GROUP = "אצוות מהחילוץ";
export const CHANGES_GROUP = "שינויים בתיק";

const key = (s: string) => s.trim().toLocaleLowerCase("he").replace(/\s+/g, " ");

type SupplierTask = { title: string; supplierName: string | null; supplierExperience: SupplierExperience | null; supplierRecordedAt: Date | null; createdAt: Date };

/// One line per supplier named on the client's tasks (decision 2: a
/// one-off supplier stays in the tasks and is never saved twice). A name
/// that is already one of the client's organizations is that
/// organization, not a second line. Newest first; the latest experience
/// is the one that counts.
export function oneOffSuppliers(tasks: SupplierTask[], organizationNames: string[], day: (d: Date) => string | null): (DocItem & { group: string })[] {
  const known = new Set(organizationNames.map(key));
  const byName = new Map<string, { name: string; tasks: SupplierTask[] }>();
  const at = (t: SupplierTask) => (t.supplierRecordedAt ?? t.createdAt).getTime();
  for (const t of [...tasks].sort((a, b) => at(b) - at(a))) {
    const name = t.supplierName?.trim().replace(/\s+/g, " ");
    if (!name || known.has(key(name))) continue;
    const entry = byName.get(key(name)) ?? { name, tasks: [] };
    entry.tasks.push(t);
    byName.set(key(name), entry);
  }
  return [...byName.values()].map(({ name, tasks: list }) => {
    const last = list[0];
    const experience = list.find((t) => t.supplierExperience)?.supplierExperience;
    return {
      text: name,
      details: [
        list.length === 1 ? `משימה: ${last.title}` : `${list.length} משימות, האחרונה: ${last.title}`,
        day(last.supplierRecordedAt ?? last.createdAt),
        experience ? SUPPLIER_EXPERIENCE_LABELS[experience] : null,
      ],
      group: ONE_OFF_GROUP,
    };
  });
}

type Batch = { createdAt: Date; via: string; note: string | null; source: { code: string; title: string } | null; states: string[] };

/// A batch as section 16 reads it: when, from which source, and what
/// became of its proposals.
export function batchItem(b: Batch, day: (d: Date) => string | null): DocItem & { group: string } {
  const count = (s: string) => b.states.filter((x) => x === s).length;
  const approved = count("APPROVED");
  const rejected = count("REJECTED");
  const pending = count("PENDING");
  const tasks = count("TASK");
  return {
    text: `${day(b.createdAt)}: ${b.source ? b.source.title : "אצווה בלי מקור"}`,
    details: [
      b.via === "SCREEN" ? "מהמסך" : "מ-Claude",
      b.states.length === 1 ? "הצעה אחת" : `${b.states.length} הצעות`,
      approved ? `${approved} אושרו` : null,
      rejected ? `${rejected} נדחו` : null,
      ...(tasks ? [tasks === 1 ? "אחת הפכה למשימה" : `${tasks} הפכו למשימות`] : []),
      pending ? `${pending} ממתינות` : null,
      b.note,
    ],
    sources: b.source ? [b.source.code] : [],
    group: BATCH_GROUP,
  };
}

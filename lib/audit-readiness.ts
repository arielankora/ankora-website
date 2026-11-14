// The procedure document's tab (14.11.2026, processes redesign, stage 4,
// "Document.dc.html"): whether a procedure is ready for an audit, and why
// its document is out of date. Pure: the server gathers the facts, the
// screen and the tests read the same answer.

export type ReadinessAction = "compliance" | "steps" | "work" | "translation" | "stranger" | null;

export type ReadinessItem = {
  key: string;
  ok: boolean;
  /// What the line says, as a key of clients.processes.document.items and
  /// its values.
  text: { key: string; values?: Record<string, string | number> };
  /// Where it is completed.
  action: ReadinessAction;
  /// A documentation field that may be marked "לא רלוונטי".
  field?: string;
};

export type ReadinessInput = {
  scope: string | null;
  controlRefs: string[];
  classification: string | null;
  /// The approved version's steps, each with how we know it was done.
  steps: { evidence?: string | null; verification?: string | null }[];
  /// Documentation fields still missing, less those marked not relevant.
  docMissing: { field: string; label: string }[];
  translation: "none" | "draft" | "approved";
  /// The steps of the process's closed runs, and those with a link to
  /// their evidence (spec 4.5). Named closed/withEvidence since stage 4.
  runs: { closed: number; withEvidence: number };
  strangerOpen: number;
};

/// The readiness list, in the order the board shows it: what is in order
/// first among the compliance fields, then what is missing.
export function auditReadiness(input: ReadinessInput): { items: ReadinessItem[]; missing: number } {
  const items: ReadinessItem[] = [];
  items.push(
    input.controlRefs.length
      ? { key: "controls", ok: true, text: { key: "controlsOk", values: { refs: input.controlRefs.join(", ") } }, action: null }
      : { key: "controls", ok: false, text: { key: "controlsMissing" }, action: "compliance" }
  );
  items.push(
    input.classification
      ? { key: "classification", ok: true, text: { key: "classificationOk", values: { level: input.classification } }, action: null }
      : { key: "classification", ok: false, text: { key: "classificationMissing" }, action: "compliance" }
  );
  items.push(input.scope?.trim() ? { key: "scope", ok: true, text: { key: "scopeOk" }, action: null } : { key: "scope", ok: false, text: { key: "scopeMissing" }, action: "compliance" });
  const noEvidence = input.steps.map((s, i) => (s.evidence?.trim() || s.verification?.trim() ? 0 : i + 1)).filter(Boolean);
  if (input.steps.length) {
    items.push(
      noEvidence.length
        ? { key: "evidence", ok: false, text: { key: "evidenceMissing", values: { list: listNumbers(noEvidence), form: noEvidence.length === 1 ? "one" : "other" } }, action: "steps" }
        : { key: "evidence", ok: true, text: { key: "evidenceOk" }, action: null }
    );
  }
  for (const d of input.docMissing) items.push({ key: `doc:${d.field}`, ok: false, text: { key: "docMissing", values: { label: d.label } }, action: "work", field: d.field });
  items.push(
    input.translation === "approved"
      ? { key: "translation", ok: true, text: { key: "translationOk" }, action: null }
      : { key: "translation", ok: false, text: { key: input.translation === "draft" ? "translationDraft" : "translationMissing" }, action: "translation" }
  );
  if (input.strangerOpen) items.push({ key: "stranger", ok: false, text: { key: "strangerOpen", values: { count: input.strangerOpen } }, action: "stranger" });
  if (input.runs.closed) {
    items.push({
      key: "runs",
      ok: input.runs.withEvidence === input.runs.closed,
      text: { key: "runs", values: { done: input.runs.withEvidence, total: input.runs.closed } },
      action: null,
    });
  }
  // What is in order first, as the board lists it.
  const ordered = [...items.filter((i) => i.ok && i.key !== "runs"), ...items.filter((i) => !i.ok), ...items.filter((i) => i.ok && i.key === "runs")];
  return { items: ordered, missing: items.filter((i) => !i.ok).length };
}

/// "2 ו-5", "1, 3 ו-4".
export function listNumbers(ns: number[]): string {
  if (ns.length <= 1) return ns.join("");
  return `${ns.slice(0, -1).join(", ")} ו-${ns[ns.length - 1]}`;
}

export type StaleReason =
  | { key: "approverLeft"; step: number; name: string; at: string | null }
  | { key: "rhythmChanged" }
  | { key: "ruleChanged"; title: string; at: string };

/// Why the approved document is out of date (spec 5.5, every client): an
/// approver at the client left, the rhythm changed after the approval, or
/// one of the client's rules that bind procedures changed after it. Each
/// reason one line. None without an approved version.
export function staleReasons(input: {
  approvedAt: Date | null;
  approverLeft: { step: number; name: string; at?: string | null }[];
  rhythmChangedAt: Date | null;
  rules: { title: string; updatedAt: Date }[];
}): StaleReason[] {
  if (!input.approvedAt) return [];
  const out: StaleReason[] = input.approverLeft.map((l) => ({ key: "approverLeft", step: l.step, name: l.name, at: l.at ?? null }));
  if (input.rhythmChangedAt && input.rhythmChangedAt > input.approvedAt) out.push({ key: "rhythmChanged" });
  for (const r of input.rules) if (r.updatedAt > input.approvedAt) out.push({ key: "ruleChanged", title: r.title, at: r.updatedAt.toISOString() });
  return out;
}

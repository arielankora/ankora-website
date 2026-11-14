// A step's approver, and how a client's approval was given (processes
// redesign, stage 3, spec 4.4 and 4.5). Pure: read by the steps editor,
// the run's page and the server alike.

/// The ways a contact approves, in the order "Run.dc.html" lists them.
export const APPROVAL_HOWS = ["EMAIL", "WHATSAPP", "PHONE", "MEETING", "SIGNED"] as const;
export type ApprovalHow = (typeof APPROVAL_HOWS)[number];

export type ClientApprovalEvidence = {
  /// The day the contact approved, "YYYY-MM-DD".
  at: string;
  how: ApprovalHow;
  link: string | null;
  /// Who wrote it down, and when.
  byUserId: string;
  recordedAt: string;
};

/// A stored evidence row, or null when it is not one.
export function readApprovalEvidence(value: unknown): ClientApprovalEvidence | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.at !== "string" || !(APPROVAL_HOWS as readonly string[]).includes(v.how as string)) return null;
  return {
    at: v.at,
    how: v.how as ApprovalHow,
    link: typeof v.link === "string" && v.link ? v.link : null,
    byUserId: typeof v.byUserId === "string" ? v.byUserId : "",
    recordedAt: typeof v.recordedAt === "string" ? v.recordedAt : "",
  };
}

/// Steps of approved procedures whose client approver has left: the
/// process needs a new approver (spec 4.6). `steps` are the approved
/// version's; `left` maps a contact id to the name that left.
export function stepsNeedingApprover(
  steps: { title: string; approverContactId?: string | null }[],
  left: Map<string, string>,
  legacyContactId?: string | null
): { step: number; name: string }[] {
  const out: { step: number; name: string }[] = [];
  steps.forEach((st, i) => {
    const id = st.approverContactId ?? null;
    if (id && left.has(id)) out.push({ step: i + 1, name: left.get(id)! });
  });
  if (!out.length && legacyContactId && left.has(legacyContactId)) out.push({ step: 0, name: left.get(legacyContactId)! });
  return out;
}

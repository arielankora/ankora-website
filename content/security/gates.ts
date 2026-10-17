/**
 * Claims on the security page that wait on something not done yet.
 *
 * A sentence, list item, vendor row or FAQ answer that depends on an open step
 * carries one of these keys, and the page leaves it out while the gate is false.
 * The copy is written and approved in full; opening a gate is a one-line change
 * here once the step behind it is closed, so the page never says more than is true.
 *
 * Each key names its step in the Ankora task "טיפול בנושאי אבטחה" (Ankora פנימי).
 */
export const SECURITY_GATES = {
  /** Claude and OpenAI on paid plans, with training on our data switched
   *  off on every account. Confirmed by Ariel, 16.10.2026. */
  openaiTier: true,
  /** Fireflies terms on our plan checked: no training, business retention. */
  firefliesTier: false,
  /** A client can mark a task or material as "no AI" (development task). */
  noAi: false,
  /** Every team member has signed the personal confidentiality undertaking. */
  confidentiality: false,
  /** A written DPA with every vendor: Vercel Pro and the Google Workspace CDPA. */
  vendorDpas: true,
  /** A completed security questionnaire ready to send on request. */
  questionnaire: true,
} as const;

export type SecurityGate = keyof typeof SECURITY_GATES;

/** A piece of copy that may depend on an open gate. */
export interface Gated {
  text: string;
  gate?: SecurityGate;
}

export function isOpen(gate: SecurityGate | undefined, gates: Record<SecurityGate, boolean> = SECURITY_GATES): boolean {
  return gate === undefined || gates[gate];
}

/** Keeps only the items whose gate is open (or that have none). */
export function openOnly<T extends { gate?: SecurityGate }>(
  items: readonly T[],
  gates: Record<SecurityGate, boolean> = SECURITY_GATES
): T[] {
  return items.filter((item) => isOpen(item.gate, gates));
}

/** Joins the open sentences of a paragraph. */
export function openText(parts: readonly Gated[], gates: Record<SecurityGate, boolean> = SECURITY_GATES): string {
  return openOnly(parts, gates)
    .map((p) => p.text)
    .join(" ");
}

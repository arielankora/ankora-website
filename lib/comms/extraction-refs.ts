// Extraction from stored communications (14.11.2026): how a source in a
// client's register says which WhatsApp stretch or which recorded call it
// came from, so the next extraction reads only what is new. Pure, unit
// tested (tests/unit/comms-extraction-refs.test.ts).
//
//   WHATSAPP  "<conversation id>:<from YYYY-MM-DD>:<to YYYY-MM-DD>"
//   CALL      the call's id

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function whatsappRefId(conversationId: string, from: string, to: string): string {
  return `${conversationId}:${from}:${to}`;
}

export function parseWhatsappRef(id: string): { conversationId: string; from: string; to: string } | null {
  const parts = id.split(":");
  if (parts.length !== 3) return null;
  const [conversationId, from, to] = parts;
  if (!conversationId || !DAY.test(from) || !DAY.test(to) || from > to) return null;
  return { conversationId, from, to };
}

export type ProcessedComms = {
  /// conversation id -> the last day already read.
  whatsappReadThrough: Map<string, string>;
  calls: Set<string>;
};

/// What the register's sources say was already read.
export function processedComms(refs: Array<{ system?: unknown; id?: unknown }>): ProcessedComms {
  const out: ProcessedComms = { whatsappReadThrough: new Map(), calls: new Set() };
  for (const r of refs) {
    if (typeof r?.id !== "string") continue;
    if (r.system === "CALL") out.calls.add(r.id);
    if (r.system === "WHATSAPP") {
      const w = parseWhatsappRef(r.id);
      if (!w) continue;
      const seen = out.whatsappReadThrough.get(w.conversationId);
      if (!seen || w.to > seen) out.whatsappReadThrough.set(w.conversationId, w.to);
    }
  }
  return out;
}

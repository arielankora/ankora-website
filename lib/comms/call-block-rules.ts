// Blocks on call recordings (14.11.2026, Ariel's decision). "לא לשמור
// שיחות עם המספר הזה" is set on a WhatsApp number, and it now also holds
// on the Aloha line of the same person: a number Hadas blocked on her
// WhatsApp is not kept from her line either. It does not reach another
// person's line.
//
// Pure: who owns which line, and which numbers each owner blocked, in; the
// state of one call out. Unit tested on its own
// (tests/unit/comms-call-blocks.test.ts).

export type CallBlockState = "none" | "pending" | "blocked";

export type OwnerBlock = { ownerUserId: string; phone: string; status: "PENDING" | "APPROVED" };

export type CallBlockIndex = {
  stateFor(line: string | null, otherPhone: string): CallBlockState;
};

/// `ownerByLine`: line (E.164) -> the owner's user id.
export function buildCallBlockIndex(ownerByLine: Map<string, string>, blocks: OwnerBlock[]): CallBlockIndex {
  const byOwner = new Map<string, CallBlockState>();
  for (const b of blocks) {
    const key = `${b.ownerUserId}|${b.phone}`;
    const state: CallBlockState = b.status === "APPROVED" ? "blocked" : "pending";
    // A block in force on one of the owner's numbers wins over a request.
    if (byOwner.get(key) !== "blocked") byOwner.set(key, state);
  }
  return {
    stateFor(line, otherPhone) {
      if (!line || line === otherPhone) return "none";
      const owner = ownerByLine.get(line);
      if (!owner) return "none";
      return byOwner.get(`${owner}|${otherPhone}`) ?? "none";
    },
  };
}

/// The lines one person owns.
export function linesOf(ownerByLine: Map<string, string>, userId: string): string[] {
  return [...ownerByLine].filter(([, owner]) => owner === userId).map(([line]) => line);
}

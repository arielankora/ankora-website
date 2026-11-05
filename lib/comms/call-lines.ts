import { normalizeEmail, normalizePhone } from "@/lib/contact-normalize";

// Whose line a call was on (2.11.2026). Aloha records two of our numbers:
// Hadas's and Anna's. Each records into the same mailbox, and each email
// names both numbers of the call, so the line is known for every call.
// The person a line belongs to sees every call on it, on top of the calls
// of the clients they manage.
//
// ALOHA_LINE_OWNERS pairs a line with its person's email:
//   "+972553302266=hadas@ankora.co.il,+972553356775=annam@ankora.co.il"
// A line missing here is still ours (ALOHA_LINE_NUMBER), just owned by
// nobody in particular: the full viewers and the call viewers see it.

/// line (E.164) -> email
export function parseLineOwners(raw: string | undefined | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of (raw ?? "").split(/[,;\n]/)) {
    const [rawPhone, rawEmail] = pair.split("=");
    if (!rawPhone || !rawEmail) continue;
    const phone = normalizePhone(rawPhone.trim());
    const email = normalizeEmail(rawEmail.trim());
    if (phone && /^\+\d{8,15}$/.test(phone) && email) out.set(phone, email);
  }
  return out;
}

/// The lines that belong to this email.
export function linesOwnedBy(owners: Map<string, string>, email: string | null | undefined): string[] {
  const me = normalizeEmail(email ?? "");
  if (!me) return [];
  return [...owners].filter(([, owner]) => owner === me).map(([line]) => line);
}

/// Our line on a stored call: the number that is not the other side.
/// Unknown when the call was stored before its line was configured. A
/// recording Aloha sent by hand (lib/comms/manual-import.ts) has no other
/// side, and is stored with our line in both places.
export function storedCallLine(rec: { direction: string; fromPhone: string; toPhone: string }): string | null {
  if (rec.direction === "IN") return rec.toPhone;
  if (rec.direction === "OUT") return rec.fromPhone;
  if (rec.fromPhone === rec.toPhone && rec.fromPhone) return rec.fromPhone;
  return null;
}

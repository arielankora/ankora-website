import type { CommsAccessLevel, UserRole } from "@prisma/client";
import { normalizeEmail } from "@/lib/contact-normalize";

// The rules behind giving access to the communications screen
// (12.11.2026). Pure, so they are tested without a database; the writes
// live in lib/app-domain/comms-access.ts.

export const COMMS_LEVELS: readonly CommsAccessLevel[] = ["NONE", "OWN", "CALLS", "FULL"];

export const COMMS_LEVEL_LABEL: Record<CommsAccessLevel, string> = {
  NONE: "ללא גישה",
  OWN: "המספר שלו והלקוחות שהוא מנהל",
  CALLS: "גם כל השיחות הטלפוניות",
  FULL: "הכול: כל השיחות וכל ההקלטות",
};

/// Levels that show conversations and calls of clients the person does not
/// manage. Given only after the confidentiality undertaking is signed in
/// both channels, in the app and as a returned PDF (Ariel, 12.11.2026).
/// OWN is given at once: it shows a person only their own number and line,
/// and the clients already assigned to them.
export function levelNeedsConfidentiality(level: CommsAccessLevel): boolean {
  return level === "CALLS" || level === "FULL";
}

/// `code` is the domainErrors key the screen shows in the reader's language
/// (ADR 0006); `error` stays the Hebrew sentence for MCP and logs.
export type GrantCheck = { ok: true } | { ok: false; error: string; code: "commsAccess.staffOnly" | "commsAccess.needsConfidentiality" };

export function checkCommsGrant(input: {
  level: CommsAccessLevel;
  targetRole: UserRole;
  confidentialitySigned: boolean;
}): GrantCheck {
  if (input.level === "NONE") return { ok: true };
  if (input.targetRole === "CLIENT_USER") return { ok: false, code: "commsAccess.staffOnly", error: "גישה למסך התקשורת ניתנת רק לאנשי צוות של אנקורה." };
  if (levelNeedsConfidentiality(input.level) && !input.confidentialitySigned) {
    return {
      ok: false,
      code: "commsAccess.needsConfidentiality",
      error: "אפשר לתת את הרמה הזו רק אחרי שההתחייבות לסודיות חתומה בשני הערוצים: באפליקציה וב-PDF. עד אז אפשר לתת \"המספר שלו והלקוחות שהוא מנהל\".",
    };
  }
  return { ok: true };
}

export type LineOwnerRow = { line: string; email: string | null };

/// The environment's owners, with what the app says laid over them. A row
/// from the app with no email takes the line off its environment owner.
export function mergeLineOwners(fromEnv: Map<string, string>, fromApp: LineOwnerRow[]): Map<string, string> {
  const out = new Map(fromEnv);
  for (const row of fromApp) {
    const email = row.email ? normalizeEmail(row.email) : null;
    if (email) out.set(row.line, email);
    else out.delete(row.line);
  }
  return out;
}

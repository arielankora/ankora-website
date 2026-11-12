import "server-only";
import type { CommsAccessLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/contact-normalize";
import { parseViewerEmails } from "./visibility";
import { parseLineOwners } from "./call-lines";
import { parseEmailList } from "@/lib/whatsapp-poc/access";
import { mergeLineOwners, type LineOwnerRow } from "./grant-rules";

// Who the communications screen opens to, read from two places
// (12.11.2026). The app is where access is given now: a level on the
// person's page (User.commsAccessLevel) and an owner per Aloha line
// (CommsLineOwner). The Vercel lists that used to be the only place
// (COMMS_FULL_VIEWERS, COMMS_CALL_VIEWERS, ALOHA_LINE_OWNERS) still count,
// so nobody loses access while they are emptied out.

/// Everyone who sees every conversation and call: the environment list,
/// and the people whose level in the app is FULL.
export async function fullViewerEmails(): Promise<string[]> {
  const fromApp = await prisma.user.findMany({
    where: { commsAccessLevel: "FULL", status: "ACTIVE", deletedAt: null, role: { not: "CLIENT_USER" } },
    select: { email: true },
  });
  return union(parseViewerEmails(process.env.COMMS_FULL_VIEWERS), fromApp.map((u) => u.email));
}

/// Everyone who hears every call recording: the environment list, and the
/// people whose level in the app is CALLS (FULL is counted as full above).
export async function callViewerEmails(): Promise<string[]> {
  const fromApp = await prisma.user.findMany({
    where: { commsAccessLevel: "CALLS", status: "ACTIVE", deletedAt: null, role: { not: "CLIENT_USER" } },
    select: { email: true },
  });
  return union(parseViewerEmails(process.env.COMMS_CALL_VIEWERS), fromApp.map((u) => u.email));
}

/// line (E.164) -> owner's email. What the app says about a line wins over
/// the environment, including "nobody".
export async function lineOwnerEmails(): Promise<Map<string, string>> {
  const rows = await prisma.commsLineOwner.findMany({ select: { line: true, user: { select: { email: true, deletedAt: true } } } });
  const fromApp: LineOwnerRow[] = rows.map((r) => ({ line: r.line, email: r.user && !r.user.deletedAt ? r.user.email : null }));
  return mergeLineOwners(parseLineOwners(process.env.ALOHA_LINE_OWNERS), fromApp);
}

/// The level the environment alone gives this address, so the person's page
/// can say where an access it did not set comes from.
export function environmentLevelFor(email: string): CommsAccessLevel {
  const me = normalizeEmail(email);
  if (!me) return "NONE";
  if (parseViewerEmails(process.env.COMMS_FULL_VIEWERS).includes(me)) return "FULL";
  if (parseEmailList(process.env.WHATSAPP_POC_VIEWERS).includes(me)) return "FULL";
  if (parseViewerEmails(process.env.COMMS_CALL_VIEWERS).includes(me)) return "CALLS";
  return "NONE";
}

function union(a: string[], b: string[]): string[] {
  const out = new Set(a);
  for (const e of b) {
    const n = normalizeEmail(e);
    if (n) out.add(n);
  }
  return [...out];
}

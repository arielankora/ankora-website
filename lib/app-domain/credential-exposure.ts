import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";

// "Which client logins did this person see?" (DPA section 4, approved by
// Ariel 7.10.2026): when someone leaves Ankora, each client receives the
// list of its credentials that person revealed in the 90 days before, so
// the client can change exactly those and not all of them.
//
// Built entirely from the audit log. Every reveal is already a
// `credential.reveal` row with the actor, the credential and the time, and
// the log is append-only, so the report cannot disagree with the evidence.
// Credentials deleted since are still listed, by the name they had: the
// login was seen while it existed, and the client may still be using it.
//
// Names, counts and dates only. Never a secret.
//
// Producing the report is itself audited. It answers a sensitive question
// about a person, and the same log that records reveals should record who
// asked who revealed what.

export const EXPOSURE_WINDOW_DAYS = 90;

export interface ExposureItem {
  credentialId: string;
  systemName: string;
  revealCount: number;
  lastRevealedAt: Date;
  deleted: boolean;
}

export interface ExposureByClient {
  clientId: string;
  clientName: string;
  items: ExposureItem[];
}

export interface ExposureReport {
  user: { id: string; name: string; email: string };
  since: Date;
  until: Date;
  clients: ExposureByClient[];
}

export async function credentialExposureReport(
  actor: User,
  userId: string,
  now = new Date(),
  days = EXPOSURE_WINDOW_DAYS,
): Promise<ExposureReport> {
  assertCan(actor.role, "user.manage");

  const subject = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!subject) throw new Error("המשתמש לא נמצא.");

  const since = new Date(now.getTime() - days * 24 * 60 * 60_000);
  const reveals = await prisma.auditEvent.findMany({
    where: {
      actorId: userId,
      action: "credential.reveal",
      entityType: "ClientCredential",
      createdAt: { gte: since, lte: now },
    },
    select: { entityId: true, clientId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const credentialIds = [...new Set(reveals.map((r) => r.entityId).filter((x): x is string => Boolean(x)))];
  const credentials = await prisma.clientCredential.findMany({
    where: { id: { in: credentialIds } },
    select: { id: true, clientId: true, systemName: true, deletedAt: true, client: { select: { name: true } } },
  });
  const byId = new Map(credentials.map((c) => [c.id, c]));

  const grouped = new Map<string, ExposureByClient>();
  const items = new Map<string, ExposureItem>();
  for (const r of reveals) {
    const cred = r.entityId ? byId.get(r.entityId) : undefined;
    if (!cred) continue;
    let item = items.get(cred.id);
    if (!item) {
      item = { credentialId: cred.id, systemName: cred.systemName, revealCount: 0, lastRevealedAt: r.createdAt, deleted: Boolean(cred.deletedAt) };
      items.set(cred.id, item);
      let group = grouped.get(cred.clientId);
      if (!group) {
        group = { clientId: cred.clientId, clientName: cred.client.name, items: [] };
        grouped.set(cred.clientId, group);
      }
      group.items.push(item);
    }
    item.revealCount += 1;
    // Rows arrive newest first, so the first one seen is the latest.
  }

  const clients = [...grouped.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "he"));
  for (const g of clients) g.items.sort((a, b) => a.systemName.localeCompare(b.systemName, "he"));

  await recordAudit({
    actorId: actor.id,
    action: "credential.exposure_report",
    entityType: "User",
    entityId: userId,
    after: { days, clients: clients.length, credentials: items.size },
  });

  return { user: subject, since, until: now, clients };
}

/// The message to a client, ready to copy. Ankora never sends to a client
/// by itself (claude/client-communication-rule-2026-09-25.md); a person
/// pastes it and presses send.
export function exposureMessageFor(report: ExposureReport, group: ExposureByClient): string {
  const fmt = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" });
  const lines = group.items.map((i) => `- ${i.systemName} (צפייה אחרונה ${fmt.format(i.lastRevealedAt)})`);
  return [
    "שלום,",
    "",
    `${report.user.name} סיים/ה את עבודתו/ה באנקורה. בהתאם לנספח עיבוד המידע, אלה פרטי הגישה שלכם שבהם צפה/תה ב-${EXPOSURE_WINDOW_DAYS} הימים האחרונים:`,
    "",
    ...lines,
    "",
    "ההרשאות שלו/ה במערכות אנקורה כבר בוטלו. אנחנו ממליצים להחליף את הסיסמאות האלה, ונשמח לעדכן אותן בכספת אחרי ההחלפה.",
    "",
    "צוות אנקורה",
  ].join("\n");
}

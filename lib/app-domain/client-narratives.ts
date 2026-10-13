import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { assertCan } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { checkSources } from "@/lib/knowledge-sources";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import type { User, NarrativeKind } from "@prisma/client";

// Org brain, phase 2: the file's free text, overview, background and our
// role (claude/org-brain-spec-2026-10-12.md, 3.3; section 2 of Hadas's
// file). Versioned like a task plan: every save is a new version and the
// old ones stay readable, so "nothing is overwritten" holds for prose too.
//
// Two people editing at once do not silently overwrite each other: a save
// names the version it was written against, and a save against an older
// one is refused with the version that is current now.

export const NARRATIVE_KINDS: NarrativeKind[] = ["OVERVIEW", "BACKGROUND", "OUR_ROLE"];

export class NarrativeConflictError extends Error {
  constructor(public readonly current: number) {
    super(`בינתיים נשמרה גרסה ${current}. צריך לפתוח מחדש ולערוך את הגרסה הנוכחית.`);
  }
}

export async function saveNarrative(actor: User, input: { clientId: string; kind: NarrativeKind; body: string; baseVersion: number }) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);
  const body = input.body.trim();
  if (body.length > 20000) throw new Error("הטקסט ארוך מדי.");
  // Codes cited in the text must exist (R17). The text itself needs no
  // source: it is a summary, and its claims carry their own codes.
  const register = await prisma.clientSource.findMany({ where: { clientId: input.clientId, deletedAt: null }, select: { code: true, weight: true } });
  const check = checkSources("MISSING", [], register, [body]);
  if (!check.ok) throw new Error(check.error);

  const latest = await prisma.clientNarrative.findFirst({
    where: { clientId: input.clientId, kind: input.kind },
    orderBy: { version: "desc" },
    select: { version: true, body: true },
  });
  const current = latest?.version ?? 0;
  if (input.baseVersion !== current) throw new NarrativeConflictError(current);
  if (latest && latest.body === body) return null;

  try {
    const row = await prisma.clientNarrative.create({
      data: { clientId: input.clientId, kind: input.kind, version: current + 1, body, createdById: actor.id },
    });
    await recordAudit({
      actorId: actor.id,
      action: "client_narrative.save",
      entityType: "ClientNarrative",
      entityId: row.id,
      clientId: input.clientId,
      after: { kind: row.kind, version: row.version },
    });
    return row;
  } catch (err) {
    // Somebody saved the same next version a moment earlier.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new NarrativeConflictError(current + 1);
    throw err;
  }
}

/// The current version of each kind, with how many versions came before.
export async function listNarratives(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const rows = await prisma.clientNarrative.findMany({ where: { clientId }, orderBy: { version: "desc" } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return NARRATIVE_KINDS.map((kind) => {
    const versions = rows.filter((r) => r.kind === kind);
    const current = versions[0] ?? null;
    return {
      kind,
      current: current ? { ...current, createdByName: current.createdById ? nameOf.get(current.createdById) ?? null : null } : null,
      history: versions.slice(1).map((v) => ({ version: v.version, body: v.body, createdAt: v.createdAt, createdByName: v.createdById ? nameOf.get(v.createdById) ?? null : null })),
    };
  });
}

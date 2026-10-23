import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCan, canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { canSeeKnowledgeItem, canSendToAi } from "@/lib/knowledge";
import { findSecrets } from "@/lib/secret-scan";
import { readSteps } from "@/lib/process-rules";
import { assertClientAccess } from "@/lib/app-domain/client-sources";
import {
  buildProcedureDoc,
  fingerprintSource,
  readSnapshot,
  readTranslation,
  translationGaps,
  type HistoryRow,
  type ProcedureDoc,
  type ProcedureLang,
  type ProcedureSnapshot,
  type ProcedureTranslation,
} from "@/lib/procedure-document";

// A client's procedures as documents (23.10.2026): the snapshot frozen
// when a version is approved, the read view, the files, and the English
// translation Claude drafts and a manager approves. The shape of the
// document itself is lib/procedure-document.ts; this file is who may see
// which version, and where the names come from.

type Db = Prisma.TransactionClient | typeof prisma;

const contactLabel = (c: { role: string | null; person: { name: string | null } }) =>
  c.person.name ? (c.role ? `${c.person.name} (${c.role})` : c.person.name) : c.role ?? null;

const join = (parts: (string | null | undefined)[]) => parts.filter((p): p is string => !!p && !!p.trim()).join(". ") || null;

/// The process as it stands now, names resolved: what an approval
/// freezes. `db` lets the approval take it inside its transaction.
export async function buildSnapshot(processId: string, frozenBy: ProcedureSnapshot["frozenBy"], db: Db = prisma, now = new Date()): Promise<ProcedureSnapshot> {
  const p = await db.process.findUniqueOrThrow({ where: { id: processId }, include: { client: { select: { name: true } }, versions: { select: { steps: true } } } });
  const userIds = [p.ownerId, p.backupOwnerId, p.approverUserId, p.executorUserId].filter((x): x is string => !!x);
  const contactIds = [p.approverContactId, p.executorContactId, ...p.externalPartyContactIds].filter((x): x is string => !!x);
  const stepSystemIds = p.versions.flatMap((v) => readSteps(v.steps).flatMap((s) => s.systemIds));
  const [users, contacts, systems] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    // A document is read outside the product (a client, an auditor, and
    // Claude for the translation): a contact who is sensitive or kept to
    // a few people is not named in it.
    contactIds.length
      ? db.clientContact.findMany({
          where: { id: { in: contactIds }, deletedAt: null, sensitivity: "NORMAL", audience: "ALL_STAFF" },
          select: { id: true, role: true, person: { select: { name: true } } },
        })
      : [],
    db.systemAccess.findMany({ where: { clientId: p.clientId, id: { in: [...new Set([...p.requiredSystemIds, ...stepSystemIds])] } }, select: { id: true, systemName: true } }),
  ]);
  const user = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? null : null);
  const contact = (id: string | null) => {
    const c = id ? contacts.find((x) => x.id === id) : null;
    return c ? contactLabel(c) : null;
  };
  const systemName = new Map(systems.map((s) => [s.id, s.systemName]));
  const permissions = (p.requiredSystemPermissions ?? {}) as Record<string, unknown>;
  return {
    v: 1,
    frozenAt: now.toISOString(),
    frozenBy,
    clientName: p.client.name,
    code: p.code,
    title: p.title,
    purpose: p.purpose,
    scope: p.scope,
    definitions: p.definitions,
    triggerKinds: p.triggerKinds,
    triggerText: p.triggerText,
    slaText: p.slaText,
    owner: user(p.ownerId),
    backupOwner: user(p.backupOwnerId),
    executor: join([user(p.executorUserId), contact(p.executorContactId), p.executorText]),
    approver: join([user(p.approverUserId), contact(p.approverContactId), p.approverText]),
    approvalText: p.approvalText,
    externalParty: join([...p.externalPartyContactIds.map(contact), p.externalPartyText]),
    systems: p.requiredSystemIds
      .filter((id) => systemName.has(id))
      .map((id) => ({ name: systemName.get(id)!, permission: typeof permissions[id] === "string" && permissions[id] ? (permissions[id] as string) : null })),
    systemNames: Object.fromEntries(systemName),
    exceptionPlaybook: p.exceptionPlaybook,
    controlRefs: p.controlRefs,
    classification: p.classification,
    relatedDocs: p.relatedDocs,
    reviewEveryDays: p.reviewEveryDays,
  };
}

export function fingerprint(doc: ProcedureDoc): string {
  return createHash("sha256").update(fingerprintSource(doc)).digest("hex");
}

/// The process, if this person may read it: on the client, staff, and in
/// the process's audience.
async function readableProcess(actor: User, processId: string) {
  assertCan(actor.role, "time_entry.create_self");
  const p = await prisma.process.findUnique({
    where: { id: processId },
    include: { versions: { orderBy: { version: "desc" } }, client: { select: { accountManagerId: true, name: true } } },
  });
  if (!p || p.deletedAt) throw new Error("התהליך לא נמצא.");
  await assertClientAccess(actor, p.clientId);
  if (!canSeeKnowledgeItem(p, { id: actor.id, isManager: canManageClients(actor.role) }, p.client.accountManagerId)) throw new Error("התהליך לא נמצא.");
  return p;
}

export type TranslationState = "NONE" | "DRAFT" | "APPROVED";

function translationState(v: { translationEn: unknown; translationEnApprovedAt: Date | null }): TranslationState {
  if (!v.translationEn) return "NONE";
  return v.translationEnApprovedAt ? "APPROVED" : "DRAFT";
}

export type ProcedureDocumentView = {
  processId: string;
  clientId: string;
  code: string;
  doc: ProcedureDoc;
  fingerprint: string;
  versions: { version: number; status: string; approvedAt: Date | null; translation: TranslationState }[];
  translation: { state: TranslationState; gaps: string[]; by: string | null; at: Date | null; approvedBy: string | null; approvedAt: Date | null } | null;
};

/// One version of a process as a document. No version: the approved
/// one, or the draft when nothing is approved yet. English only from an
/// approved translation, unless `draftTranslation` (the manager reviewing
/// it before approving).
export async function procedureDocument(
  actor: User,
  processId: string,
  options: { version?: number; lang?: ProcedureLang; omitEmpty?: boolean; draftTranslation?: boolean } = {}
): Promise<ProcedureDocumentView> {
  const p = await readableProcess(actor, processId);
  if (p.versions.length === 0) throw new Error("לתהליך הזה עוד אין נוהל.");
  const v =
    options.version !== undefined
      ? p.versions.find((x) => x.version === options.version)
      : p.versions.find((x) => x.status === "APPROVED") ?? p.versions[0];
  if (!v) throw new Error("הגרסה לא נמצאה.");

  const frozen = readSnapshot(v.document);
  const snapshot = frozen ?? (await buildSnapshot(p.id, "approval"));
  const userIds = [...new Set([...p.versions.map((x) => x.approvedById), v.translationEnById, v.translationEnApprovedById].filter((x): x is string => !!x))];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const name = (id: string | null) => (id ? users.get(id) ?? null : null);

  const lang = options.lang ?? "he";
  const state = translationState(v);
  let translation: ProcedureTranslation | null = null;
  if (lang === "en") {
    if (state === "NONE" || (state === "DRAFT" && !options.draftTranslation)) throw new Error("לגרסה הזו אין עדיין תרגום מאושר לאנגלית.");
    translation = readTranslation(v.translationEn);
    if (!translation) throw new Error("התרגום השמור לא תקין. צריך לתרגם מחדש.");
  }

  const history: HistoryRow[] = p.versions
    .filter((x) => x.status !== "DRAFT" || x.id === v.id)
    .map((x) => ({ version: x.version, status: x.status, approvedAt: x.approvedAt, approvedBy: name(x.approvedById), changeNote: x.changeNote }));
  const doc = buildProcedureDoc({
    lang,
    snapshot,
    version: {
      version: v.version,
      status: v.status,
      steps: v.steps,
      highlights: v.highlights,
      outputs: v.outputs,
      changeNote: v.changeNote,
      createdAt: v.createdAt,
      approvedAt: v.approvedAt,
      approvedBy: name(v.approvedById),
    },
    history,
    translation,
    live: !frozen,
    omitEmpty: options.omitEmpty ?? false,
  });
  const steps = readSteps(v.steps);
  const parsed = readTranslation(v.translationEn);
  return {
    processId: p.id,
    clientId: p.clientId,
    code: p.code,
    doc,
    fingerprint: fingerprint(doc),
    versions: p.versions.map((x) => ({ version: x.version, status: x.status, approvedAt: x.approvedAt, translation: translationState(x) })),
    translation:
      state === "NONE"
        ? null
        : {
            state,
            gaps: parsed ? translationGaps(snapshot, { steps, highlights: v.highlights, outputs: v.outputs }, parsed) : ["invalid"],
            by: name(v.translationEnById),
            at: v.translationEnAt,
            approvedBy: name(v.translationEnApprovedById),
            approvedAt: v.translationEnApprovedAt,
          },
  };
}

/// What Claude needs to translate the approved version: the Hebrew
/// fields, in the shape the translation is saved in.
export async function translationSource(actor: User, processId: string) {
  const p = await readableProcess(actor, processId);
  // Rule 3 (lib/knowledge.ts): what may leave the product for Claude.
  if (!canSendToAi(p, actor.id)) throw new Error("This process is sensitive or restricted, so it is not sent to Claude. Translate it by hand.");
  const v = p.versions.find((x) => x.status === "APPROVED");
  if (!v) throw new Error("רק נוהל מאושר מתורגם. לתהליך הזה אין עדיין גרסה מאושרת.");
  const snapshot = readSnapshot(v.document) ?? (await buildSnapshot(p.id, "translation"));
  const steps = readSteps(v.steps);
  const approvers = await prisma.user.findMany({ where: { id: { in: p.versions.map((x) => x.approvedById).filter((x): x is string => !!x) } }, select: { name: true } });
  return {
    processId: p.id,
    version: v.version,
    current: translationState(v),
    hebrew: {
      title: snapshot.title,
      purpose: snapshot.purpose,
      scope: snapshot.scope,
      definitions: snapshot.definitions,
      triggerText: snapshot.triggerText,
      slaText: snapshot.slaText,
      owner: snapshot.owner,
      backupOwner: snapshot.backupOwner,
      executor: snapshot.executor,
      approver: snapshot.approver,
      approvalText: snapshot.approvalText,
      externalParty: snapshot.externalParty,
      systems: snapshot.systems,
      exceptionPlaybook: snapshot.exceptionPlaybook,
      relatedDocs: snapshot.relatedDocs,
      steps: steps.map((s) => ({ title: s.title, output: s.output, verification: s.verification })),
      highlights: v.highlights,
      outputs: v.outputs,
      changeNotes: Object.fromEntries(p.versions.filter((x) => x.status !== "DRAFT" && x.changeNote).map((x) => [String(x.version), x.changeNote!])),
      names: [...new Set([snapshot.owner, snapshot.backupOwner, ...approvers.map((a) => a.name)].filter((x): x is string => !!x))],
    },
  };
}

/// Saves an English translation of the approved version, as a draft for
/// a manager to approve. Returns what it still leaves out; it is saved
/// either way, so Claude can fill the rest. A version approved before
/// snapshots existed is frozen now, so the translation and the Hebrew it
/// was made from never drift apart.
export async function saveProcedureTranslation(actor: User, processId: string, version: number, value: unknown) {
  const p = await readableProcess(actor, processId);
  const v = p.versions.find((x) => x.version === version);
  if (!v) throw new Error("הגרסה לא נמצאה.");
  if (v.status !== "APPROVED") throw new Error("רק הגרסה המאושרת מתורגמת.");
  const tr = readTranslation(value);
  if (!tr) throw new Error("התרגום צריך לפחות כותרת ורשימת שלבים.");
  if (findSecrets(JSON.stringify(tr)).length) throw new Error("יש בתרגום סיסמה, מפתח או מספר כרטיס.");
  const snapshot = readSnapshot(v.document) ?? (await buildSnapshot(p.id, "translation"));
  const gaps = translationGaps(snapshot, { steps: readSteps(v.steps), highlights: v.highlights, outputs: v.outputs }, tr);
  await prisma.processVersion.update({
    where: { id: v.id },
    data: {
      document: v.document ?? (snapshot as unknown as Prisma.InputJsonValue),
      translationEn: tr as unknown as Prisma.InputJsonValue,
      translationEnById: actor.id,
      translationEnAt: new Date(),
      translationEnApprovedById: null,
      translationEnApprovedAt: null,
    },
  });
  await recordAudit({ actorId: actor.id, action: "process.translation_save", entityType: "Process", entityId: p.id, clientId: p.clientId, after: { version, gaps: gaps.length, froze: !v.document } });
  return { version, gaps };
}

export async function approveProcedureTranslation(actor: User, processId: string, version: number) {
  if (!canManageClients(actor.role)) throw new Error("רק מנהל מאשר תרגום.");
  const p = await readableProcess(actor, processId);
  const v = p.versions.find((x) => x.version === version);
  if (!v || !v.translationEn) throw new Error("אין תרגום לאשר.");
  if (v.translationEnApprovedAt) return;
  const snapshot = readSnapshot(v.document);
  const tr = readTranslation(v.translationEn);
  if (!snapshot || !tr) throw new Error("התרגום השמור לא תקין. צריך לתרגם מחדש.");
  const gaps = translationGaps(snapshot, { steps: readSteps(v.steps), highlights: v.highlights, outputs: v.outputs }, tr);
  if (gaps.length) throw new Error(`התרגום לא שלם: ${gaps.slice(0, 5).join(", ")}${gaps.length > 5 ? "..." : ""}`);
  await prisma.processVersion.update({ where: { id: v.id }, data: { translationEnApprovedById: actor.id, translationEnApprovedAt: new Date() } });
  await recordAudit({ actorId: actor.id, action: "process.translation_approve", entityType: "Process", entityId: p.id, clientId: p.clientId, after: { version } });
}

/// Every procedure of the client in force, as documents, for one file an
/// auditor can read front to back: the approved version of each active or
/// paused process this person may see. In English, a process without an
/// approved translation is listed as skipped rather than half translated.
export async function clientProcedurePack(actor: User, clientId: string, lang: ProcedureLang) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true, accountManagerId: true } });
  if (!client) throw new Error("הלקוח לא נמצא.");
  const viewer = { id: actor.id, isManager: canManageClients(actor.role) };
  const rows = await prisma.process.findMany({
    where: { clientId, deletedAt: null, status: { in: ["ACTIVE", "PAUSED"] }, versions: { some: { status: "APPROVED" } } },
    orderBy: { seq: "asc" },
    select: { id: true, code: true, title: true, audience: true, audienceUserIds: true },
  });
  const docs: { doc: ProcedureDoc; fingerprint: string }[] = [];
  const skipped: { code: string; title: string; reason: string }[] = [];
  for (const r of rows.filter((x) => canSeeKnowledgeItem(x, viewer, client.accountManagerId))) {
    try {
      const view = await procedureDocument(actor, r.id, { lang, omitEmpty: true });
      docs.push({ doc: view.doc, fingerprint: view.fingerprint });
    } catch (err) {
      skipped.push({ code: r.code, title: r.title, reason: err instanceof Error ? err.message : "שגיאה" });
    }
  }
  return { clientName: client.name, docs, skipped };
}

/// An export is a record that a document left the product: who, which
/// version, which language, which format. SOC 2 asks for exactly this.
export async function recordProcedureExport(
  actor: User,
  entry: { clientId: string; processId?: string; version?: number; lang: ProcedureLang; format: "pdf" | "docx"; fingerprint?: string; count?: number }
) {
  await recordAudit({
    actorId: actor.id,
    action: entry.processId ? "process.document_export" : "process.document_pack_export",
    entityType: entry.processId ? "Process" : "Client",
    entityId: entry.processId ?? entry.clientId,
    clientId: entry.clientId,
    after: { version: entry.version, lang: entry.lang, format: entry.format, fingerprint: entry.fingerprint, count: entry.count },
  });
}

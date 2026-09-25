import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan, ForbiddenError } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { resolvePortalClient, assertPortalWritable } from "@/lib/app-domain/client-portal";
import type { User } from "@prisma/client";

// Portal phase 2: decisions.
//
// Two sides, one file, because they are one contract: Ankora asks, the
// client answers, and what the client agreed to must still be readable a
// year later. Splitting the write path from the read path would have let
// them drift on the one thing that must not drift - the snapshot.
//
// Client isolation follows the same rule as every other portal function:
// the client side never takes a clientId from its caller, only from
// resolvePortalClient. The staff side goes through
// listAccessibleClients() exactly like tasks do.

export interface DecisionOptionInput {
  label: string;
  detail?: string | null;
  /// Agorot. See schema.prisma on Client.approvalCeilingMinor for why
  /// money is never a float here.
  amountMinor?: number | null;
  recommended?: boolean;
}

export interface DecisionOptionView {
  id: string;
  label: string;
  detail: string | null;
  amountMinor: number | null;
  recommended: boolean;
}

export interface DecisionView {
  id: string;
  question: string;
  background: string | null;
  amountMinor: number | null;
  /// The ceiling as it stood when the decision was opened, and whether
  /// the amount crosses it. Both are shown to the client: "this is above
  /// the limit you set, which is why it is your call" is the sentence
  /// that makes an approval feel like control rather than paperwork.
  ceilingMinor: number | null;
  aboveCeiling: boolean;
  dueAt: Date | null;
  status: "OPEN" | "ANSWERED" | "CANCELLED";
  createdAt: Date;
  options: DecisionOptionView[];
  /// The promise this decision blocks, in the client's words.
  taskTitle: string | null;
  answer: {
    optionLabel: string;
    amountMinor: number | null;
    respondedAt: Date;
    respondedByName: string;
  } | null;
}

const MAX_OPTIONS = 3;

function toView(decision: {
  id: string;
  question: string;
  background: string | null;
  amountMinor: number | null;
  ceilingMinorAtCreation: number | null;
  dueAt: Date | null;
  status: string;
  createdAt: Date;
  options: DecisionOptionView[];
  task: { title: string; clientTitle: string | null } | null;
  response: { optionLabelSnapshot: string; amountMinorSnapshot: number | null; respondedAt: Date; respondedBy: { name: string } } | null;
}): DecisionView {
  const ceiling = decision.ceilingMinorAtCreation;
  return {
    id: decision.id,
    question: decision.question,
    background: decision.background,
    amountMinor: decision.amountMinor,
    ceilingMinor: ceiling,
    aboveCeiling: ceiling !== null && decision.amountMinor !== null && decision.amountMinor > ceiling,
    dueAt: decision.dueAt,
    status: decision.status as DecisionView["status"],
    createdAt: decision.createdAt,
    options: decision.options,
    taskTitle: decision.task ? decision.task.clientTitle?.trim() || decision.task.title : null,
    answer: decision.response
      ? {
          optionLabel: decision.response.optionLabelSnapshot,
          amountMinor: decision.response.amountMinorSnapshot,
          respondedAt: decision.response.respondedAt,
          respondedByName: decision.response.respondedBy.name,
        }
      : null,
  };
}

const DECISION_INCLUDE = {
  options: {
    select: { id: true, label: true, detail: true, amountMinor: true, recommended: true },
    orderBy: { position: "asc" as const },
  },
  task: { select: { title: true, clientTitle: true } },
  response: {
    select: {
      optionLabelSnapshot: true,
      amountMinorSnapshot: true,
      respondedAt: true,
      respondedBy: { select: { name: true } },
    },
  },
};

// ---------------------------------------------------------------------------
// Ankora's side
// ---------------------------------------------------------------------------

/// Opens a decision and tells the client it is waiting.
///
/// The client's ceiling is copied onto the row here rather than read at
/// display time: a later change to the agreed ceiling must never rewrite
/// what an old approval said the limit was.
export async function createDecision(
  actor: User,
  input: {
    clientId: string;
    taskId?: string | null;
    question: string;
    background?: string | null;
    amountMinor?: number | null;
    dueAt?: Date | null;
    options: DecisionOptionInput[];
  }
) {
  // Same gate as tasks: anyone who may work on a client's account may ask
  // that client a question about it. See lib/app-domain/tasks.ts for why
  // no dedicated permission exists for per-client work.
  assertCan(actor.role, "time_entry.create_self");

  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === input.clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }

  const question = input.question.trim();
  if (!question) throw new Error("יש לנסח את השאלה שהלקוח צריך להכריע בה.");

  const options = input.options
    .map((o) => ({ ...o, label: o.label.trim() }))
    .filter((o) => o.label.length > 0);

  // Two is the minimum that makes this a decision rather than a notice,
  // and three is where a decision stops reducing load and starts adding
  // it. Both ends are product rules, so both are enforced here rather
  // than left to whichever screen happens to call this.
  if (options.length < 2) throw new Error("יש להזין לפחות שתי אפשרויות.");
  if (options.length > MAX_OPTIONS) throw new Error(`אפשר עד ${MAX_OPTIONS} אפשרויות בהחלטה אחת.`);
  if (options.filter((o) => o.recommended).length > 1) {
    throw new Error("אפשר לסמן המלצה אחת בלבד.");
  }

  const client = await prisma.client.findFirstOrThrow({ where: { id: input.clientId, deletedAt: null } });

  if (input.taskId) {
    const task = await prisma.task.findFirst({ where: { id: input.taskId, clientId: client.id, deletedAt: null } });
    if (!task) throw new Error("המשימה המקושרת אינה שייכת ללקוח הזה.");
  }

  const decision = await prisma.decision.create({
    data: {
      clientId: client.id,
      taskId: input.taskId || null,
      question,
      background: input.background?.trim() || null,
      amountMinor: input.amountMinor ?? null,
      ceilingMinorAtCreation: client.approvalCeilingMinor,
      dueAt: input.dueAt ?? null,
      createdById: actor.id,
      options: {
        create: options.map((o, i) => ({
          label: o.label,
          detail: o.detail?.trim() || null,
          amountMinor: o.amountMinor ?? null,
          recommended: o.recommended ?? false,
          position: i,
        })),
      },
    },
    include: DECISION_INCLUDE,
  });

  await recordAudit({
    actorId: actor.id,
    action: "decision.create",
    entityType: "Decision",
    entityId: decision.id,
    clientId: client.id,
    after: { question: decision.question, amountMinor: decision.amountMinor, options: options.length },
  });

  // Deliberately NOT notifying the client from here.
  //
  // Ariel, 25.9.2026: nothing goes out to a client automatically. This
  // was the one place in the product that did - an email fired as a side
  // effect of creating a decision, which nobody chose to send and nobody
  // read before it went.
  //
  // Nothing was lost by removing it. The decision screen offers the
  // "הודעה ללקוח" composer with the message already written, so the
  // person who created the decision reads it, fixes it, and sends it
  // themselves. Same client, same information, one person in between.
  //
  // See claude/client-communication-rule-2026-09-25.md.

  return decision;
}

/// Withdraws a question that stopped being relevant. Kept as a row: a
/// client who watched a decision appear and then vanish deserves the
/// record that it did.
export async function cancelDecision(actor: User, decisionId: string) {
  assertCan(actor.role, "time_entry.create_self");

  const decision = await prisma.decision.findUnique({ where: { id: decisionId } });
  if (!decision) throw new Error("ההחלטה לא נמצאה.");

  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === decision.clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }
  if (decision.status === "ANSWERED") throw new Error("אי אפשר לבטל החלטה שכבר נענתה.");

  const updated = await prisma.decision.update({
    where: { id: decisionId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });

  await recordAudit({
    actorId: actor.id,
    action: "decision.cancel",
    entityType: "Decision",
    entityId: decisionId,
    clientId: decision.clientId,
    before: decision,
    after: updated,
  });

  return updated;
}

/// Every decision for one client, for the staff panel on the client
/// screen. Newest first, because the open ones are the recent ones.
export async function listDecisionsForClient(actor: User, clientId: string): Promise<DecisionView[]> {
  assertCan(actor.role, "time_entry.create_self");

  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }

  const rows = await prisma.decision.findMany({
    where: { clientId },
    include: DECISION_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toView);
}

// ---------------------------------------------------------------------------
// The client's side
// ---------------------------------------------------------------------------

/// What the portal shows. Open decisions first (they are the reason the
/// screen exists), then the answered and withdrawn ones as a record.
export async function getPortalDecisions(actor: User): Promise<{ open: DecisionView[]; closed: DecisionView[] }> {
  const { client } = await resolvePortalClient(actor);

  const rows = await prisma.decision.findMany({
    where: { clientId: client.id },
    include: DECISION_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  const views = rows.map(toView);
  return {
    open: views.filter((d) => d.status === "OPEN"),
    closed: views.filter((d) => d.status !== "OPEN"),
  };
}

/// The client's answer, and the only write a client makes in this phase.
///
/// Three things happen atomically: the option is recorded with a snapshot
/// of what it said, the decision closes, and - when the decision was
/// attached to a promise - that promise stops waiting on the client. The
/// third one matters: without it a client answers, and the portal keeps
/// telling them the same thing is waiting for them.
export async function respondToDecision(actor: User, decisionId: string, optionId: string) {
  const ctx = await resolvePortalClient(actor);
  // A staff preview may read the client's decisions and must never answer
  // one: an approval attributed to a client who never gave it is the one
  // record in this product that has to be beyond doubt.
  assertPortalWritable(ctx);

  // Spec 4's two client roles: a Viewer reads the portal, an Admin is the
  // person who signed. Approving money is the Admin's.
  if (ctx.clientUserRole !== "ADMIN") {
    throw new ForbiddenError("Only a Client Admin may answer a decision");
  }

  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, clientId: ctx.client.id },
    include: { options: true },
  });
  if (!decision) throw new ForbiddenError("Decision does not belong to this client");
  if (decision.status !== "OPEN") throw new Error("ההחלטה הזו כבר נסגרה.");

  const option = decision.options.find((o) => o.id === optionId);
  if (!option) throw new Error("האפשרות שנבחרה אינה שייכת להחלטה הזו.");

  const [response] = await prisma.$transaction([
    prisma.decisionResponse.create({
      data: {
        decisionId: decision.id,
        optionId: option.id,
        respondedById: actor.id,
        questionSnapshot: decision.question,
        optionLabelSnapshot: option.label,
        amountMinorSnapshot: option.amountMinor ?? decision.amountMinor,
      },
    }),
    prisma.decision.update({ where: { id: decision.id }, data: { status: "ANSWERED" } }),
    // The client just answered, so the client is no longer what we are
    // waiting on. Scoped to a block that names THEM: a task waiting on
    // a supplier keeps waiting, and clearing it here because a
    // different question was answered would quietly tell everyone the
    // supplier came back.
    ...(decision.taskId
      ? [
          prisma.task.updateMany({
            where: { id: decision.taskId, blockedOn: "CLIENT" },
            data: { blockedOn: null, blockedReason: null, blockedSince: null },
          }),
        ]
      : []),
  ]);

  await recordAudit({
    actorId: actor.id,
    action: "decision.respond",
    entityType: "Decision",
    entityId: decision.id,
    clientId: ctx.client.id,
    after: {
      option: option.label,
      amountMinor: response.amountMinorSnapshot,
      ceilingMinorAtCreation: decision.ceilingMinorAtCreation,
    },
  });

  return response;
}

import "server-only";
import { prisma } from "@/lib/prisma";
import { isPastValidity } from "@/lib/client-facts";
import {
  ATTENTION_EVERY_DAYS,
  DAY_MS,
  attentionSentence,
  hasAttention,
  isStaleProposal,
  isStaleProposedRule,
  isStaleUncertain,
  PROPOSAL_WAIT_DAYS,
  type Attention,
} from "@/lib/client-file-attention";
import { UNCERTAIN_REMINDER_DAYS } from "@/lib/client-facts";
import { ruleReviewDue } from "@/lib/client-policies";

// Org brain, phase 2: the daily look at every client file
// (claude/org-brain-spec-2026-10-12.md, 3.4 and 5.4). Runs on the existing
// daily cron, like everything else that has to happen without anybody
// asking (app/api/cron/alerts-reconcile).
//
// One notification per person per client, at most once a week: a file
// that nags daily is a file people stop reading. The exception is a
// temporary item that expired since the last one, because "is this still
// true?" is a question with a date on it.
//
// Who hears: the client's account manager, about everything; whoever
// chases an open question or owns a temporary item, about theirs; and an
// item's owner (spec 3.1), about the uncertain items they keep. A client
// with no account manager and nobody else to tell is counted, not
// silently skipped.
//
// Every kind of item in the file is looked at: facts, people,
// organizations, systems, entities, request types, rules and processes.

export const ATTENTION_TYPE = "client_file.attention";

const ZERO: Attention = { pastValidity: 0, staleUncertain: 0, openQuestions: 0, staleProposedRules: 0, rulesDueReview: 0 };

export async function notifyClientFileAttention(now = new Date()): Promise<{ notified: number; unowned: number }> {
  const staleBefore = new Date(now.getTime() - UNCERTAIN_REMINDER_DAYS * DAY_MS);
  const live = { deletedAt: null, client: { status: "ACTIVE" as const, deletedAt: null } };

  const stale = { knowledgeStatus: "UNCERTAIN" as const, updatedAt: { lt: staleBefore } };
  const row = { clientId: true, knowledgeStatus: true, updatedAt: true, ownerId: true } as const;

  const proposalsBefore = new Date(now.getTime() - PROPOSAL_WAIT_DAYS * DAY_MS);
  const [facts, contacts, orgs, systems, entities, requestTypes, processes, policies, proposals] = await Promise.all([
    prisma.clientFact.findMany({
      where: {
        ...live,
        knowledgeStatus: { not: "SUPERSEDED" },
        OR: [
          { kind: "TEMPORARY", closedAt: null, validUntil: { lt: now } },
          { kind: "QUESTION", answeredAt: null },
          { knowledgeStatus: "UNCERTAIN", updatedAt: { lt: staleBefore } },
        ],
      },
      select: { clientId: true, kind: true, validUntil: true, closedAt: true, answeredAt: true, assigneeId: true, ownerId: true, knowledgeStatus: true, updatedAt: true },
    }),
    prisma.clientContact.findMany({ where: { ...live, ...stale }, select: row }),
    prisma.clientOrganization.findMany({ where: { ...live, ...stale }, select: row }),
    prisma.systemAccess.findMany({ where: { ...live, ...stale }, select: row }),
    prisma.clientEntity.findMany({ where: { ...live, ...stale }, select: row }),
    prisma.requestType.findMany({ where: { ...live, ...stale }, select: row }),
    prisma.process.findMany({ where: { ...live, ...stale, status: { not: "RETIRED" } }, select: row }),
    prisma.clientPolicy.findMany({
      where: { ...live, status: { not: "RETIRED" }, OR: [stale, { status: "PROPOSED", createdAt: { lt: staleBefore } }, { reviewBy: { lte: now } }] },
      select: { ...row, status: true, createdAt: true, reviewBy: true },
    }),
    // Proposals waiting on the review screen (20.10.2026). A batch still
    // waiting for a person to pick its client has no proposals yet.
    prisma.knowledgeProposal.findMany({
      where: { state: "PENDING", createdAt: { lt: proposalsBefore }, batch: { client: { status: "ACTIVE", deletedAt: null } } },
      select: { clientId: true, state: true, createdAt: true, batch: { select: { createdById: true } } },
    }),
  ]);

  // Per client: the counts for the account manager, each assignee's own
  // questions and expired items, and the latest expiry (to know whether
  // it is news).
  type Bucket = { all: Attention; byAssignee: Map<string, Attention>; latestExpiry: Date | null };
  const buckets = new Map<string, Bucket>();
  const bucket = (clientId: string) => {
    let b = buckets.get(clientId);
    if (!b) buckets.set(clientId, (b = { all: { ...ZERO }, byAssignee: new Map(), latestExpiry: null }));
    return b;
  };

  const theirs = (b: Bucket, userId: string) => {
    let a = b.byAssignee.get(userId);
    if (!a) b.byAssignee.set(userId, (a = { ...ZERO }));
    return a;
  };

  for (const f of facts) {
    const b = bucket(f.clientId);
    const mine = () => {
      let a = b.byAssignee.get(f.assigneeId!);
      if (!a) b.byAssignee.set(f.assigneeId!, (a = { ...ZERO }));
      return a;
    };
    if (isPastValidity(f, now)) {
      b.all.pastValidity++;
      if (f.assigneeId) mine().pastValidity++;
      if (!b.latestExpiry || f.validUntil! > b.latestExpiry) b.latestExpiry = f.validUntil;
    }
    if (f.kind === "QUESTION" && !f.answeredAt) {
      b.all.openQuestions++;
      if (f.assigneeId) mine().openQuestions++;
    } else if (isStaleUncertain(f, now)) {
      b.all.staleUncertain++;
      if (f.ownerId) theirs(b, f.ownerId).staleUncertain++;
    }
  }
  for (const item of [...contacts, ...orgs, ...systems, ...entities, ...requestTypes, ...processes, ...policies]) {
    if (!isStaleUncertain(item, now)) continue;
    const b = bucket(item.clientId);
    b.all.staleUncertain++;
    // Spec 3.1: the person who keeps it hears about it.
    if (item.ownerId) theirs(b, item.ownerId).staleUncertain++;
  }
  // A rule the client set, still waiting for a manager: the account
  // manager's to chase.
  for (const rule of policies) {
    if (isStaleProposedRule(rule, now)) bucket(rule.clientId).all.staleProposedRules++;
    // Spec 3.11: its review date passed. The manager and its owner hear,
    // every week, until someone reviews it and sets the next date.
    if (ruleReviewDue(rule, now)) {
      const b = bucket(rule.clientId);
      b.all.rulesDueReview = (b.all.rulesDueReview ?? 0) + 1;
      if (rule.ownerId) {
        const t = theirs(b, rule.ownerId);
        t.rulesDueReview = (t.rulesDueReview ?? 0) + 1;
      }
    }
  }

  // Waiting proposals: the account manager hears about all of them, and
  // whoever sent a batch about their own (Ariel, 20.10.2026), so a file
  // with no account manager, like Ankora's own, still reaches someone.
  for (const p of proposals) {
    if (!isStaleProposal(p, now)) continue;
    const b = bucket(p.clientId);
    b.all.staleProposals = (b.all.staleProposals ?? 0) + 1;
    if (p.batch.createdById) {
      const t = theirs(b, p.batch.createdById);
      t.staleProposals = (t.staleProposals ?? 0) + 1;
    }
  }

  const clients = await prisma.client.findMany({
    where: { id: { in: [...buckets.keys()] } },
    select: { id: true, name: true, accountManagerId: true, accountManager: { select: { status: true, deletedAt: true } } },
  });

  let notified = 0;
  let unowned = 0;
  const weekAgo = new Date(now.getTime() - ATTENTION_EVERY_DAYS * DAY_MS);

  for (const client of clients) {
    const b = buckets.get(client.id)!;
    if (!hasAttention(b.all)) continue;
    const manager =
      client.accountManagerId && client.accountManager?.status === "ACTIVE" && !client.accountManager.deletedAt ? client.accountManagerId : null;

    const recipients = new Map<string, Attention>();
    if (manager) recipients.set(manager, b.all);
    for (const [assignee, theirs] of b.byAssignee) {
      if (assignee !== manager) recipients.set(assignee, theirs);
    }
    if (recipients.size === 0) {
      unowned++;
      continue;
    }

    for (const [userId, attention] of recipients) {
      const last = await prisma.notification.findFirst({
        where: { userId, type: ATTENTION_TYPE, entityId: client.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const expiredSince = attention.pastValidity > 0 && b.latestExpiry !== null && (!last || b.latestExpiry > last.createdAt);
      if (last && last.createdAt > weekAgo && !expiredSince) continue;

      await prisma.notification.create({
        data: {
          userId,
          type: ATTENTION_TYPE,
          title: `תיק ${client.name}: מה מחכה לתשומת לב`,
          body: attentionSentence(attention),
          entityType: "Client",
          entityId: client.id,
          // Stamped with the run's own clock, the one the week is counted
          // against. With the database's clock, a run for any other "now"
          // (the tests, from 15.10.2026) compared a past week with today.
          createdAt: now,
        },
      });
      notified++;
    }
  }
  return { notified, unowned };
}

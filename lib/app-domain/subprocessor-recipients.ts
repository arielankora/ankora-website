import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import type { SubprocessorNotice, User } from "@prisma/client";

// P8 step 8 (3.11.2026): who is told about a new sub-processor, and how.
// Every client Ankora works for, active or paused, except Ankora's own
// internal client. Three groups, in the order a person sends: emailed by
// contract, emailed because nobody checked yet, and told on the website.

export type SubprocessorRecipient = {
  id: string;
  name: string;
  status: string;
  notice: SubprocessorNotice;
  source: string | null;
  checkedAt: Date | null;
  aiExcluded: boolean;
};

export type SubprocessorRecipients = {
  committed: SubprocessorRecipient[];
  unchecked: SubprocessorRecipient[];
  notCommitted: SubprocessorRecipient[];
};

export async function listSubprocessorRecipients(actor: User): Promise<SubprocessorRecipients> {
  assertCan(actor.role, "client.manage");
  const rows = await prisma.client.findMany({
    where: { deletedAt: null, isInternal: false, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      subprocessorNotice: true,
      subprocessorNoticeSource: true,
      subprocessorNoticeCheckedAt: true,
      aiExcluded: true,
    },
  });
  const all: SubprocessorRecipient[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    notice: r.subprocessorNotice,
    source: r.subprocessorNoticeSource,
    checkedAt: r.subprocessorNoticeCheckedAt,
    aiExcluded: r.aiExcluded,
  }));
  return {
    committed: all.filter((c) => c.notice === "COMMITTED"),
    unchecked: all.filter((c) => c.notice === "UNCHECKED"),
    notCommitted: all.filter((c) => c.notice === "NOT_COMMITTED"),
  };
}

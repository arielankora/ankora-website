import "server-only";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";
import { listProcesses } from "@/lib/app-domain/processes";
import { listSystemMap } from "@/lib/app-domain/system-map";
import { listClientPeople } from "@/lib/app-domain/client-contacts";
import { readinessOf, type Readiness } from "@/lib/handover-readiness";

// The client's handover readiness, as this person may see it: the
// processes, systems and contacts come through the screens' own readers,
// so an item hidden from them is not counted here either.

export async function handoverReadiness(actor: User, clientId: string): Promise<Readiness> {
  const [processes, systems, people] = await Promise.all([listProcesses(actor, clientId), listSystemMap(actor, clientId), listClientPeople(actor, clientId)]);
  const userIds = [...new Set(processes.map((p) => p.executorUserId).filter((x): x is string => !!x))];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const contactName = new Map(people.contacts.map((c) => [c.id, c.person.name ?? c.role ?? ""]));
  const systemById = new Map(systems.map((s) => [s.id, s]));
  return readinessOf(
    processes.map((p) => {
      const perms = (p.requiredSystemPermissions ?? {}) as Record<string, unknown>;
      const ids = [...new Set([...p.requiredSystemIds, ...(p.current?.steps ?? []).flatMap((st) => st.systemIds)])];
      return {
        id: p.id,
        code: p.code,
        title: p.title,
        status: p.status,
        transitionStatus: p.transitionStatus,
        ownerId: p.ownerId,
        executor: (p.executorUserId && users.get(p.executorUserId)) || (p.executorContactId && contactName.get(p.executorContactId)) || p.executorText,
        hasApprovedProcedure: !!p.current,
        completeness: p.completeness.score,
        systems: ids
          .map((id) => systemById.get(id))
          .filter((s): s is NonNullable<typeof s> => !!s)
          .map((s) => ({ id: s.id, name: s.systemName, accessStatus: s.accessStatus, permission: typeof perms[s.id] === "string" ? (perms[s.id] as string) : null })),
      };
    })
  );
}

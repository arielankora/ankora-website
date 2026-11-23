import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { skillOf, type AgentRequirements } from "@/lib/agents/model";

// "skills: [{ slug, minVersion }]" (23.11.2026): get_agent says when a
// skill this agent needs is an Ankora skill the person runs in a version
// older than required, or does not run at all. A skill that is not an
// Ankora skill cannot be checked here; the requirements line names it.

export async function skillGaps(actor: User, requirements: AgentRequirements): Promise<string[]> {
  const out: string[] = [];
  for (const s of requirements.skills) {
    const { slug, minVersion } = skillOf(s);
    if (!minVersion) continue;
    const skill = await prisma.agent.findUnique({ where: { slug }, select: { id: true, kind: true, archivedAt: true } });
    if (!skill || skill.kind !== "SKILL" || skill.archivedAt) continue;
    const inst = await prisma.agentInstallation.findFirst({ where: { agentId: skill.id, userId: actor.id, status: "ACTIVE" }, select: { pinnedVersionId: true } });
    if (!inst) {
      out.push(`- הסקיל ${slug} (גרסה ${minVersion} ומעלה) לא מותקן אצלך באנקורה.`);
      continue;
    }
    const pinned = await prisma.agentVersion.findUnique({ where: { id: inst.pinnedVersionId }, select: { version: true } });
    if ((pinned?.version ?? 0) < minVersion) out.push(`- הסקיל ${slug} מותקן אצלך בגרסה ${pinned?.version ?? "?"}, וצריך לפחות גרסה ${minVersion}. מעדכנים אותו בהתקנות באנקורה.`);
  }
  return out;
}

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
      out.push(actor.locale === "en" ? `- The skill ${slug} (version ${minVersion} or later) is not installed for you in Ankora.` : `- הסקיל ${slug} (גרסה ${minVersion} ומעלה) לא מותקן אצלך באנקורה.`);
      continue;
    }
    const pinned = await prisma.agentVersion.findUnique({ where: { id: inst.pinnedVersionId }, select: { version: true } });
    const have = pinned?.version ?? "?";
    // ADR 0006: worded in the language of the person running the agent, like the rest of get_agent.
    if ((pinned?.version ?? 0) < minVersion) out.push(actor.locale === "en" ? `- The skill ${slug} is installed for you at version ${have}, and at least version ${minVersion} is needed. Update it in your installations in Ankora.` : `- הסקיל ${slug} מותקן אצלך בגרסה ${have}, וצריך לפחות גרסה ${minVersion}. מעדכנים אותו בהתקנות באנקורה.`);
  }
  return out;
}

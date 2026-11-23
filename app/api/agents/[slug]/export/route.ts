import { NextResponse } from "next/server";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { contentOf, resolveClients } from "@/lib/app-domain/agents";
import { approvedAdditions } from "@/lib/app-domain/agent-client-additions";
import { compileAgent } from "@/lib/agents/compile";
import { approvedLibrary } from "@/lib/app-domain/agent-library";
import { attachmentDisposition } from "@/lib/http-headers";

// Agents, phase 3: the version in use as a skill file (SKILL.md), for a
// place that cannot call get_agent, and as a copy kept outside Ankora.
// Compiled without an installation or a client: parameters stay as
// {{name}} placeholders, except their defaults. With ?client=<id> (24.11.2026)
// it is that client's skill: its values and its approved addition
// ("גרסה 7 + NUX 2"); a "בלי AI" client or one without access gets none.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  if (!can(user.role, "time_entry.create_self")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { slug } = await params;
  const agent = await prisma.agent.findUnique({ where: { slug: decodeURIComponent(slug) } });
  if (!agent || agent.archivedAt) return NextResponse.json({ error: "not found" }, { status: 404 });
  const version = await prisma.agentVersion.findFirst({ where: { agentId: agent.id, state: "APPROVED", faultyAt: null }, orderBy: { version: "desc" } });
  if (!version) return NextResponse.json({ error: "no approved version" }, { status: 404 });
  const content = contentOf(version);
  const clientId = new URL(request.url).searchParams.get("client");
  const clients = clientId ? await resolveClients(user, agent.id, content.params, { clientScope: "ONE", clientIds: [clientId] }) : [];
  const additions = await approvedAdditions(agent.id, clients.map((c) => c.id));
  const compiled = compileAgent({ agent, version: { version: version.version, ...content }, installation: null, clients, library: await approvedLibrary(), additions, locale: user.locale });
  const plus = additions.map((a) => `-${a.version}`).join("");
  const description = agent.purpose.replace(/\s+/g, " ").replace(/"/g, "'");
  const text = `---\nname: ${agent.slug}\ndescription: "${description}"\n---\n\n${compiled.text.trim()}\n`;
  return new NextResponse(text, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": attachmentDisposition(`${agent.slug}-v${version.version}${plus}-SKILL.md`) },
  });
}

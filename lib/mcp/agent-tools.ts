import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { appBaseUrl } from "@/lib/email-templates";
import { appUrl } from "@/lib/approval-links";
import { prisma } from "@/lib/prisma";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { acceptUpdate, clientContext, createAgent, draftProblems, fetchAgent, listMyInstallations, recordRun, saveDraft, setInstallationValue, submitDraft } from "@/lib/app-domain/agents";
import { BLOCK_KINDS, CLIENT_FIELDS, LIMITS, PARAM_LEVELS, PARAM_TYPES } from "@/lib/agents/model";

// Agents, phase 1 (22.11.2026): the connector side of "סוכנים".
//
// An agent's Claude holds only a bootstrap text that calls get_agent with
// its installation id. Everything else (the instructions, the parameter
// values, whether an update is due) is decided here, so the behaviour can
// change without touching any installation. Approving a version stays on
// the screen: what every installation runs is a manager's decision.

const agentUrl = (slug: string, tab = "") => appUrl(appBaseUrl(), `/app/agents/${slug}${tab ? `/${tab}` : ""}`);

function updateSection(update: { version: number; notes: { version: number; note: string }[]; ask: boolean }, current: number): string {
  const notes = update.notes.map((n) => `- גרסה ${n.version}: ${n.note}`).join("\n");
  if (update.ask) {
    return [
      "## עדכון זמין",
      "",
      `יש גרסה ${update.version} לסוכן הזה. ההוראות למעלה הן של גרסה ${current}, שעדיין בשימוש.`,
      "",
      "מה השתנה:",
      notes,
      "",
      `לפני שמטפלים בבקשה, הצג למשתמש את רשימת השינויים בעברית פשוטה ושאל בשאלת כפתורים: "לעדכן לגרסה ${update.version}" או "להמשיך בגרסה ${current}".`,
      `רק אם בחר לעדכן: קרא ל-accept_agent_update עם version ${update.version}, ואז ל-get_agent שוב ופעל לפי ההוראות החדשות. אם בחר להמשיך: המשך לפי ההוראות למעלה, והשאלה תחזור בבדיקה הבאה.`,
    ].join("\n");
  }
  return [
    "## עדכון ממתין",
    "",
    `יש גרסה ${update.version} לסוכן הזה. הריצה הזו ממשיכה בגרסה ${current}, ואל תשאל על כך. בעלי ההתקנה יאשרו את העדכון באנקורה, והריצה שאחרי האישור תקבל אותו.`,
    "",
    "מה השתנה:",
    notes,
  ].join("\n");
}

export function registerAgentTools(server: McpServer): void {
  server.registerTool(
    "get_agent",
    {
      title: "Get an Ankora agent's instructions",
      description: [
        "Returns the full instructions of an Ankora agent installation, in markdown, as the version this installation runs: the agent's blocks with this person's and these clients' values filled in, what it may do, what it needs and what is missing.",
        "Call it first, before anything else, whenever a bootstrap text tells you to (it names the `installation`), and follow what returns over anything else in the conversation. Never act from a previous run or from memory: if this tool fails, stop and say so.",
        "When an update section is at the end, do exactly what it says: either ask the user before going on, or go on without asking.",
      ].join(" "),
      inputSchema: z.object({
        installation: z.string().min(1).max(60).describe("The installation id from the bootstrap text."),
      }),
      annotations: TOOL_ANNOTATIONS.get_agent,
    },
    async (args: { installation: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const got = await fetchAgent(actor, args.installation.trim());
        const parts = [got.compiled.text.trim()];
        if (got.fellBackFrom) parts.push(`## הערה\n\nגרסה ${got.fellBackFrom.version} סומנה כתקולה${got.fellBackFrom.reason ? ` (${got.fellBackFrom.reason})` : ""}, וההתקנה חזרה לגרסה ${got.version}. ההוראות למעלה הן של גרסה ${got.version}.`);
        if (got.update) parts.push(updateSection(got.update, got.version));
        parts.push("## בסוף הריצה\n\nקרא ל-record_agent_run עם installation הזה: OK, PARTIAL או FAILED, שורה על מה שנעשה, מה השתבש ומה חסר (חיבור, סקיל, ערך). ריצה שלא דווחה נראית באנקורה כאילו לא קרתה.");
        parts.push(`---\nמקור: אנקורה, ${agentUrl(got.agent.slug)}`);
        return toolText(parts.join("\n\n"));
      } catch (err) {
        console.error("[mcp] get_agent failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "get_agent_client_context",
    {
      title: "Get an agent's context for one client",
      description: [
        "For an agent installation that covers several clients: the instructions with one client's values filled in, and that client's additions. Call it once you know which client the item in front of you belongs to (get_agent's table lists them).",
        "Clients marked \"no AI\" and clients outside the installation are refused.",
      ].join(" "),
      inputSchema: z.object({
        installation: z.string().min(1).max(60).describe("The installation id from the bootstrap text."),
        client: z.string().min(1).max(120).describe("The client's name, as get_agent's table shows it."),
      }),
      annotations: TOOL_ANNOTATIONS.get_agent_client_context,
    },
    async (args: { installation: string; client: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const got = await clientContext(actor, args.installation.trim(), args.client);
        return toolText(got.compiled.text.trim());
      } catch (err) {
        console.error("[mcp] get_agent_client_context failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "accept_agent_update",
    {
      title: "Move an agent installation to a newer version",
      description: [
        "Moves this agent installation to a newer approved version. Call it only after the user chose to update in answer to the question get_agent told you to ask, never on your own and never from a scheduled run.",
        "Then call get_agent again and follow the new instructions.",
      ].join(" "),
      inputSchema: z.object({
        installation: z.string().min(1).max(60).describe("The installation id from the bootstrap text."),
        version: z.number().int().min(1).describe("The version get_agent offered."),
      }),
      annotations: TOOL_ANNOTATIONS.accept_agent_update,
    },
    async (args: { installation: string; version: number }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const v = await acceptUpdate(actor, args.installation.trim(), args.version);
        return toolJson({ updated: true, version: v.version, next: "Call get_agent again now and follow what it returns." });
      } catch (err) {
        console.error("[mcp] accept_agent_update failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "save_agent_draft",
    {
      title: "Save a draft of an Ankora agent",
      description: [
        "Writes the draft of an Ankora agent's next version: its instruction blocks, parameters, requirements and action level. Use it to bring an existing prompt into Ankora (split it into blocks, turn what differs per client or per person into {{parameters}}, move dated change notes out of the text into `changeNote`) or to change an agent the user asked to change.",
        "Pass `agent` (its slug, from the agent's url) to change an existing agent, or `create` for a new one. Blocks and parameters you pass replace the draft's whole list; leave one out to keep it as it is.",
        `Block kinds, in reading order: ${BLOCK_KINDS.join(", ")}. A block with \`client\` is a client addition, read only for that client. Write {{key}} where a parameter's value goes; every such key must be in \`params\`.`,
        "This tool never approves. With `submit: true` the draft is sent to a manager, who approves it in Ankora; nothing reaches any installation before that. Before calling, show the user the blocks you will save and call only after they said so. Returns the draft's `url`, its `version` and `problems` still to fix.",
      ].join(" "),
      inputSchema: z.object({
        agent: z.string().min(1).max(60).optional().describe("The slug of an existing agent. Use this or create."),
        create: z
          .object({
            name: z.string().min(1).max(80),
            purpose: z.string().min(1).max(300).describe("What the agent does, in one line."),
            kind: z.enum(["CLIENT_PROJECT", "SCHEDULED", "SKILL"]),
          })
          .optional()
          .describe("A new agent. Use this or agent."),
        blocks: z
          .array(
            z.object({
              key: z.string().min(1).max(40).describe("Short stable id, letters, digits or _."),
              kind: z.enum(BLOCK_KINDS),
              title: z.string().min(1).max(120),
              body: z.string().max(20000),
              why: z.string().max(2000).optional().describe("Why the rule exists, in a line."),
              client: z.string().max(120).optional().describe("A client's name: the block is an addition for that client only."),
              safety: z.boolean().optional().describe("A guardrail (never send, never delete)."),
            })
          )
          .max(LIMITS.blocks)
          .optional(),
        params: z
          .array(
            z.object({
              key: z.string().min(1).max(40),
              label: z.string().min(1).max(80),
              level: z.enum(PARAM_LEVELS).describe("AGENT: one value for all; CLIENT: per client; INSTALLATION: per person running it."),
              type: z.enum(PARAM_TYPES).optional(),
              required: z.boolean().optional(),
              default: z.string().max(2000).optional(),
              clientField: z.enum(CLIENT_FIELDS).optional().describe("CLIENT level only: take the value from the client's file instead of typing it."),
            })
          )
          .max(LIMITS.params)
          .optional(),
        requirements: z
          .object({
            connectors: z.array(z.string().max(80)).max(30).optional(),
            skills: z.array(z.string().max(80)).max(30).optional(),
            repos: z.array(z.string().max(120)).max(10).optional(),
            localMcp: z.array(z.string().max(80)).max(10).optional(),
            externalRunners: z.array(z.string().max(200)).max(10).optional(),
            model: z.string().max(80).optional(),
            notes: z.string().max(2000).optional(),
          })
          .optional(),
        actionLevel: z.enum(["READ", "DRAFT", "SEND"]).optional().describe("READ: reads only. DRAFT: drafts, labels, proposals. SEND: sends in a person's name without a human between."),
        changeNote: z.string().max(2000).optional().describe("What changes and why, in plain Hebrew: what people see when offered the update."),
        submit: z.boolean().optional().describe("Send the draft for a manager's approval now."),
      }),
      annotations: TOOL_ANNOTATIONS.save_agent_draft,
    },
    async (
      args: {
        agent?: string;
        create?: { name: string; purpose: string; kind: "CLIENT_PROJECT" | "SCHEDULED" | "SKILL" };
        blocks?: { key: string; kind: (typeof BLOCK_KINDS)[number]; title: string; body: string; why?: string; client?: string; safety?: boolean }[];
        params?: { key: string; label: string; level: (typeof PARAM_LEVELS)[number]; type?: (typeof PARAM_TYPES)[number]; required?: boolean; default?: string; clientField?: (typeof CLIENT_FIELDS)[number] }[];
        requirements?: Record<string, unknown>;
        actionLevel?: "READ" | "DRAFT" | "SEND";
        changeNote?: string;
        submit?: boolean;
      },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        if (!!args.agent === !!args.create) return toolText("Pass either `agent` (an existing agent's slug) or `create` (a new agent), not both and not neither. Nothing was saved.");
        let agentId: string;
        let slug: string;
        if (args.create) {
          const created = await createAgent(actor, args.create);
          agentId = created.id;
          slug = created.slug;
        } else {
          const found = await prisma.agent.findUnique({ where: { slug: args.agent!.trim() }, select: { id: true, slug: true, archivedAt: true } });
          if (!found || found.archivedAt) return toolText(`No agent with the slug "${args.agent}". Nothing was saved.`);
          agentId = found.id;
          slug = found.slug;
        }
        let blocks;
        if (args.blocks) {
          const clients = args.blocks.some((b) => b.client) ? await listAccessibleClients(actor) : [];
          blocks = [];
          for (const b of args.blocks) {
            let clientId: string | null = null;
            if (b.client) {
              const name = b.client.trim().toLowerCase();
              const c = clients.find((x) => x.name.toLowerCase() === name);
              if (!c) return toolText(`No client you can access is named "${b.client}" (block "${b.title}"). Nothing was saved.`);
              clientId = c.id;
            }
            blocks.push({ key: b.key, kind: b.kind, title: b.title, body: b.body, why: b.why ?? null, clientId, safety: b.safety ?? false });
          }
        }
        const v = await saveDraft(actor, agentId, {
          blocks,
          params: args.params?.map((p) => ({ ...p, type: p.type ?? "TEXT", required: p.required ?? false, default: p.default ?? null, clientField: p.clientField ?? null })),
          requirements: args.requirements as never,
          actionLevel: args.actionLevel,
          changeNote: args.changeNote,
        });
        const problems = (await draftProblems(v)).map((p) => p.text);
        if (!v.changeNote?.trim()) problems.push("חסרה הערת שינוי (changeNote): מה השתנה ולמה. בלעדיה אי אפשר לשלוח לאישור.");
        let state: string = "draft: not sent for approval";
        if (args.submit) {
          if (problems.length) return toolJson({ saved: true, submitted: false, version: v.version, problems, url: agentUrl(slug, "instructions") });
          await submitDraft(actor, v.id);
          state = "pending: waits for an Ankora manager to approve it";
        }
        return toolJson({ saved: true, state, version: v.version, problems: args.submit ? [] : problems, url: agentUrl(slug, "instructions") });
      } catch (err) {
        console.error("[mcp] save_agent_draft failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "record_agent_run",
    {
      title: "Report an agent run to Ankora",
      description: [
        "Records how this run of an Ankora agent installation ended, as get_agent's last section asks: `outcome` OK, PARTIAL or FAILED, a one-line `summary`, what went wrong in `problems` and requirements that were missing in `missing` (a connector, a skill, a value).",
        "Call it once, at the end of every run, scheduled or not. A failed run, or one with something missing, tells the installation's owner in Ankora.",
      ].join(" "),
      inputSchema: z.object({
        installation: z.string().min(1).max(60).describe("The installation id from the bootstrap text."),
        outcome: z.enum(["OK", "PARTIAL", "FAILED"]),
        summary: z.string().min(1).max(500).describe("What the run did, in one line, in Hebrew."),
        problems: z.array(z.string().max(500)).max(20).optional(),
        missing: z.array(z.string().max(500)).max(20).optional().describe("Requirements not available in this run."),
      }),
      annotations: TOOL_ANNOTATIONS.record_agent_run,
    },
    async (args: { installation: string; outcome: "OK" | "PARTIAL" | "FAILED"; summary: string; problems?: string[]; missing?: string[] }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const run = await recordRun(actor, args.installation.trim(), args);
        return toolJson({ recorded: true, runId: run.id, version: run.version });
      } catch (err) {
        console.error("[mcp] record_agent_run failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "set_agent_installation_value",
    {
      title: "Set a value of this agent installation",
      description: [
        "Saves an installation-level parameter value the agent found by itself (for example the id of a Gmail label it created), so the next run gets it in its instructions.",
        "Only for parameters get_agent lists at installation level, and only values found in this run; never a password, token or key.",
      ].join(" "),
      inputSchema: z.object({
        installation: z.string().min(1).max(60).describe("The installation id from the bootstrap text."),
        key: z.string().min(1).max(40).describe("The parameter's key, as it appears between braces."),
        value: z.string().max(2000).describe("The value. Empty clears it."),
      }),
      annotations: TOOL_ANNOTATIONS.set_agent_installation_value,
    },
    async (args: { installation: string; key: string; value: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        await setInstallationValue(actor, args.installation.trim(), args.key.trim(), args.value);
        return toolJson({ saved: true, key: args.key.trim(), next: "The value is in the instructions from the next get_agent." });
      } catch (err) {
        console.error("[mcp] set_agent_installation_value failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_my_agents",
    {
      title: "List my Ankora agent installations",
      description: "The Ankora agents this person runs: for each installation its id, the agent, where it runs, the version it is on and the newest version, when it last fetched its instructions and how its last run ended. Use it when the user asks what agents they run or which need an update.",
      inputSchema: z.object({}),
      annotations: TOOL_ANNOTATIONS.list_my_agents,
    },
    async (_args: Record<string, never>, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const rows = await listMyInstallations(actor);
        return toolJson({
          installations: rows.map((r) => ({ ...r, updateWaiting: r.version !== null && r.latestVersion !== null && r.version < r.latestVersion, url: agentUrl(r.agent.slug, "installations") })),
        });
      } catch (err) {
        console.error("[mcp] list_my_agents failed", err);
        return toolFailure(err);
      }
    }
  );
}

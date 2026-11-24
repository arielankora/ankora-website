import "server-only";
import { z } from "zod";
import type { AppLocale } from "@prisma/client";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { appBaseUrl } from "@/lib/email-templates";
import { appUrl } from "@/lib/approval-links";
import { prisma } from "@/lib/prisma";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { acceptUpdate, agentFile, clientContext, createAgent, createInstallation, installQuestions, draftProblems, fetchAgent, linkedProcedure, listMyInstallations, recordRun, revertToVersion, saveDraft, setInstallationValue, submitDraft } from "@/lib/app-domain/agents";
import { proposeLesson } from "@/lib/app-domain/agent-library";
import { skillGaps } from "@/lib/app-domain/agent-skills";
import { clientAdditionProblems, saveClientAddition, submitClientAddition } from "@/lib/app-domain/agent-client-additions";
import { bootstrapText } from "@/lib/agents/compile";
import { procedureSection } from "@/lib/agents/procedure";
import { BLOCK_KINDS, CLIENT_FIELDS, LIMITS, PARAM_LEVELS, PARAM_TYPES, parseRequirements } from "@/lib/agents/model";

// Agents, phase 1 (22.11.2026): the connector side of "סוכנים".
//
// An agent's Claude holds only a bootstrap text that calls get_agent with
// its installation id. Everything else (the instructions, the parameter
// values, whether an update is due) is decided here, so the behaviour can
// change without touching any installation. Approving a version stays on
// the screen: what every installation runs is a manager's decision.

const agentUrl = (slug: string, tab = "") => appUrl(appBaseUrl(), `/app/agents/${slug}${tab ? `/${tab}` : ""}`);

// ADR 0006: the fixed lines get_agent adds around the compiled
// instructions follow the installation owner's User.locale, like the
// compiled headings (lib/agents/compile.ts). Hebrew by default.
const GET_AGENT_TEXT = {
  he: {
    versionNote: (v: number, note: string) => `- גרסה ${v}: ${note}`,
    changed: "מה השתנה:",
    available: "## עדכון זמין",
    availableBody: (next: number, current: number) => `יש גרסה ${next} לסוכן הזה. ההוראות למעלה הן של גרסה ${current}, שעדיין בשימוש.`,
    ask: (next: number, current: number) => `לפני שמטפלים בבקשה, הצג למשתמש את רשימת השינויים בעברית פשוטה ושאל בשאלת כפתורים: "לעדכן לגרסה ${next}" או "להמשיך בגרסה ${current}".`,
    askThen: (next: number) => `רק אם בחר לעדכן: קרא ל-accept_agent_update עם version ${next}, ואז ל-get_agent שוב ופעל לפי ההוראות החדשות. אם בחר להמשיך: המשך לפי ההוראות למעלה, והשאלה תחזור בבדיקה הבאה.`,
    waiting: "## עדכון ממתין",
    waitingBody: (next: number, current: number) => `יש גרסה ${next} לסוכן הזה. הריצה הזו ממשיכה בגרסה ${current}, ואל תשאל על כך. בעלי ההתקנה יאשרו את העדכון באנקורה, והריצה שאחרי האישור תקבל אותו.`,
    fellBack: (from: number, reason: string | null, to: number) => `## הערה\n\nגרסה ${from} סומנה כתקולה${reason ? ` (${reason})` : ""}, וההתקנה חזרה לגרסה ${to}. ההוראות למעלה הן של גרסה ${to}.`,
    skills: (gaps: string) => `## סקילים חסרים\n\n${gaps}\n\nאם סקיל חסר או ישן מדי: אל תנחש איך הוא עובד. דווח על כך בתחילת הריצה וב-record_agent_run (missing).`,
    end: "## בסוף הריצה\n\nאם למדת בריצה משהו שכדאי לשנות בהוראות (כלל חסר, ניסוח שהטעה), הצע אותו ב-propose_agent_change. אדם יחליט.\n\nקרא ל-record_agent_run עם installation הזה: OK, PARTIAL או FAILED, שורה על מה שנעשה, מה השתבש ומה חסר (חיבור, סקיל, ערך). ריצה שלא דווחה נראית באנקורה כאילו לא קרתה.",
    source: (url: string) => `---\nמקור: אנקורה, ${url}`,
  },
  en: {
    versionNote: (v: number, note: string) => `- Version ${v}: ${note}`,
    changed: "What changed:",
    available: "## Update available",
    availableBody: (next: number, current: number) => `Version ${next} of this agent is available. The instructions above are version ${current}, which is still in use.`,
    ask: (next: number, current: number) => `Before handling the request, show the user the list of changes in plain English and ask with buttons: "Update to version ${next}" or "Stay on version ${current}".`,
    askThen: (next: number) => `Only if they choose to update: call accept_agent_update with version ${next}, then call get_agent again and follow the new instructions. If they choose to stay: go on with the instructions above, and the question will come back at the next check.`,
    waiting: "## Update waiting",
    waitingBody: (next: number, current: number) => `Version ${next} of this agent is available. This run stays on version ${current}, and do not ask about it. The installation's owner will approve the update in Ankora, and the run after that approval will get it.`,
    fellBack: (from: number, reason: string | null, to: number) => `## Note\n\nVersion ${from} was marked faulty${reason ? ` (${reason})` : ""}, and the installation went back to version ${to}. The instructions above are version ${to}.`,
    skills: (gaps: string) => `## Missing skills\n\n${gaps}\n\nIf a skill is missing or too old: do not guess how it works. Report it at the start of the run and in record_agent_run (missing).`,
    end: "## At the end of the run\n\nIf you learned something in this run that should change the instructions (a missing rule, wording that misled), propose it with propose_agent_change. A person will decide.\n\nCall record_agent_run with this installation: OK, PARTIAL or FAILED, a line on what was done, what went wrong and what was missing (a connection, a skill, a value). A run that is not reported looks in Ankora as if it never happened.",
    source: (url: string) => `---\nSource: Ankora, ${url}`,
  },
};

function updateSection(update: { version: number; notes: { version: number; note: string }[]; ask: boolean }, current: number, locale: AppLocale): string {
  const w = GET_AGENT_TEXT[locale];
  const notes = update.notes.map((n) => w.versionNote(n.version, n.note)).join("\n");
  if (update.ask) {
    return [w.available, "", w.availableBody(update.version, current), "", w.changed, notes, "", w.ask(update.version, current), w.askThen(update.version)].join("\n");
  }
  return [w.waiting, "", w.waitingBody(update.version, current), "", w.changed, notes].join("\n");
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
        // fetchAgent runs only for the installation's owner: their language.
        const w = GET_AGENT_TEXT[actor.locale];
        const parts = [got.compiled.text.trim()];
        const procedure = await linkedProcedure(actor, got.agent.id);
        if (procedure) parts.push(procedureSection(procedure, actor.locale).trim());
        if (got.fellBackFrom) parts.push(w.fellBack(got.fellBackFrom.version, got.fellBackFrom.reason, got.version));
        const pinned = await prisma.agentVersion.findUnique({ where: { agentId_version: { agentId: got.agent.id, version: got.version } }, select: { requirements: true } });
        const gaps = pinned ? await skillGaps(actor, parseRequirements(pinned.requirements)) : [];
        if (gaps.length) parts.push(w.skills(gaps.join("\n")));
        if (got.update) parts.push(updateSection(got.update, got.version, actor.locale));
        parts.push(w.end);
        parts.push(w.source(agentUrl(got.agent.slug)));
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
    "get_agent_file",
    {
      title: "Get a file attached to an Ankora agent",
      description: [
        "Returns one text file attached to the agent version an installation runs (a script, a template, a reference). get_agent lists the files by path under \"קבצים מצורפים\".",
        "Call it when the instructions point to a file by path, with the same installation id. Use the file as it comes back; do not change it in place.",
      ].join(" "),
      inputSchema: z.object({
        installation: z.string().min(1).max(60).describe("The installation id from the bootstrap text."),
        path: z.string().min(1).max(200).describe("The file's path, exactly as get_agent lists it."),
      }),
      annotations: TOOL_ANNOTATIONS.get_agent_file,
    },
    async (args: { installation: string; path: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const file = await agentFile(actor, args.installation.trim(), args.path);
        return toolText(file.content);
      } catch (err) {
        console.error("[mcp] get_agent_file failed", err);
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
        "Pass `agent` (its slug, from the agent's url) to change an existing agent, or `create` for a new one. Blocks, parameters and files you pass replace the draft's whole list; leave one out to keep it as it is. A text file the instructions use (a script, a template, a reference) goes in `files` with the path the instructions name.",
        `Block kinds, in reading order: ${BLOCK_KINDS.join(", ")}. A rule for one client only is a client addition: save it with save_agent_client_addition, not here. Mark a block \`overridable\` when a client addition may replace it. Write {{key}} where a parameter's value goes; every such key must be in \`params\`.`,
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
              safety: z.boolean().optional().describe("A guardrail (never send, never delete)."),
              overridable: z.boolean().optional().describe("A client addition may replace this block for its client. Ignored on a safety block."),
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
              type: z.enum(PARAM_TYPES).optional().describe("CONNECTOR: the value is a connector's name. VAULT_REF: the name of an item in Ankora's vault, never the secret itself."),
              required: z.boolean().optional(),
              default: z.string().max(2000).optional(),
              clientField: z.enum(CLIENT_FIELDS).optional().describe("CLIENT level only: take the value from the client's file instead of typing it."),
            })
          )
          .max(LIMITS.params)
          .optional(),
        files: z
          .array(
            z.object({
              path: z.string().min(1).max(200).describe("Relative path the instructions use, for example scripts/build.py."),
              content: z.string().max(200_000).describe("The file's full text. No secrets."),
            })
          )
          .max(LIMITS.files)
          .optional(),
        requirements: z
          .object({
            connectors: z.array(z.string().max(80)).max(30).optional(),
            skills: z.array(z.union([z.string().max(80), z.object({ slug: z.string().min(1).max(80), minVersion: z.number().int().min(1).optional() })])).max(30).optional().describe("A skill's slug, or { slug, minVersion } when an older version of an Ankora skill is not enough."),
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
        blocks?: { key: string; kind: (typeof BLOCK_KINDS)[number]; title: string; body: string; why?: string; safety?: boolean; overridable?: boolean }[];
        params?: { key: string; label: string; level: (typeof PARAM_LEVELS)[number]; type?: (typeof PARAM_TYPES)[number]; required?: boolean; default?: string; clientField?: (typeof CLIENT_FIELDS)[number] }[];
        files?: { path: string; content: string }[];
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
        const blocks = args.blocks?.map((b) => ({ key: b.key, kind: b.kind, title: b.title, body: b.body, why: b.why ?? null, safety: b.safety ?? false, overridable: b.overridable ?? false }));
        const v = await saveDraft(actor, agentId, {
          blocks,
          params: args.params?.map((p) => ({ ...p, type: p.type ?? "TEXT", required: p.required ?? false, default: p.default ?? null, clientField: p.clientField ?? null })),
          files: args.files,
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
    "revert_agent_to_version",
    {
      title: "Revert an Ankora agent to an earlier version",
      description: [
        "Opens a draft of an Ankora agent's next version that is a copy of an earlier approved version (\"go back to version 5\" makes version 8, a copy of 5), with the change note \"חזרה לגרסה 5\". The history stays in one line.",
        "Pass `agent` (its slug) and `version`. Refused while the agent has a draft or a version waiting for approval: finish that one first. Before calling, tell the user which version you will copy and call only after they said so.",
        "This tool never approves. With `submit: true` the draft is sent to a manager, who approves it in Ankora. Returns the draft's `url` and its `version`.",
      ].join(" "),
      inputSchema: z.object({
        agent: z.string().min(1).max(60).describe("The agent's slug, from its url."),
        version: z.number().int().min(1).describe("The earlier approved version to copy."),
        submit: z.boolean().optional().describe("Send the draft for a manager's approval now."),
      }),
      annotations: TOOL_ANNOTATIONS.revert_agent_to_version,
    },
    async (args: { agent: string; version: number; submit?: boolean }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const found = await prisma.agent.findUnique({ where: { slug: args.agent.trim() }, select: { id: true, slug: true, archivedAt: true } });
        if (!found || found.archivedAt) return toolText(`No agent with the slug "${args.agent}". Nothing was saved.`);
        const v = await revertToVersion(actor, found.id, args.version);
        let state = "draft: not sent for approval";
        if (args.submit) {
          await submitDraft(actor, v.id);
          state = "pending: waits for an Ankora manager to approve it";
        }
        return toolJson({ saved: true, state, version: v.version, copyOf: args.version, url: agentUrl(found.slug, `versions?v=${v.version}`) });
      } catch (err) {
        console.error("[mcp] revert_agent_to_version failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "save_agent_client_addition",
    {
      title: "Save a client's addition to an Ankora agent",
      description: [
        "Writes the draft of one client's addition to an Ankora agent: blocks the agent reads only when it works on that client, versioned apart from the agent (the agent's version does not change; an installation on that client reads \"version 7 + <client> 2\").",
        "Pass `agent` (its slug) and `client` (its name). The blocks you pass replace the addition's whole list; leave `blocks` out to keep them. A block with `replaces` takes the place of the agent block with that key for this client, only when that block is marked overridable and is not a safety block; otherwise it is added beside it and `problems` says so.",
        "This tool never approves. With `submit: true` the draft goes to a manager, who approves it in Ankora. Before calling, show the user the blocks you will save and call only after they said so. Returns the addition's `version`, `url` and `problems` still to fix.",
      ].join(" "),
      inputSchema: z.object({
        agent: z.string().min(1).max(60).describe("The agent's slug, from its url."),
        client: z.string().min(1).max(120).describe("The client's name, as the user has it in Ankora."),
        blocks: z
          .array(
            z.object({
              key: z.string().min(1).max(40).describe("Short stable id, letters, digits or _."),
              kind: z.enum(BLOCK_KINDS),
              title: z.string().min(1).max(120),
              body: z.string().max(20000),
              why: z.string().max(2000).optional().describe("Why the rule exists, in a line."),
              replaces: z.string().max(40).optional().describe("The key of the agent block this one replaces for this client."),
            })
          )
          .max(LIMITS.blocks)
          .optional(),
        changeNote: z.string().max(2000).optional().describe("What changes and why, in plain Hebrew."),
        submit: z.boolean().optional().describe("Send the draft for a manager's approval now."),
      }),
      annotations: TOOL_ANNOTATIONS.save_agent_client_addition,
    },
    async (
      args: { agent: string; client: string; blocks?: { key: string; kind: (typeof BLOCK_KINDS)[number]; title: string; body: string; why?: string; replaces?: string }[]; changeNote?: string; submit?: boolean },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        const agent = await prisma.agent.findUnique({ where: { slug: args.agent.trim() }, select: { id: true, slug: true, archivedAt: true } });
        if (!agent || agent.archivedAt) return toolText(`No agent with the slug "${args.agent}". Nothing was saved.`);
        const name = args.client.trim().toLowerCase();
        const client = (await listAccessibleClients(actor)).find((c) => c.name.toLowerCase() === name);
        if (!client) return toolText(`No client you can access is named "${args.client}". Nothing was saved.`);
        const row = await saveClientAddition(actor, {
          agentId: agent.id,
          clientId: client.id,
          blocks: args.blocks?.map((b) => ({ key: b.key, kind: b.kind, title: b.title, body: b.body, why: b.why ?? null, replaces: b.replaces?.trim() || null })),
          changeNote: args.changeNote,
        });
        const problems = (await clientAdditionProblems(row)).map((p) => p.text);
        if (!row.changeNote?.trim()) problems.push("חסרה הערת שינוי (changeNote): מה השתנה ולמה. בלעדיה אי אפשר לשלוח לאישור.");
        const url = `${agentUrl(agent.slug, "instructions")}?client=${client.id}`;
        let state = "draft: not sent for approval";
        if (args.submit) {
          if (problems.length) return toolJson({ saved: true, submitted: false, client: client.name, version: row.version, problems, url });
          await submitClientAddition(actor, row.id);
          state = "pending: waits for an Ankora manager to approve it";
        }
        return toolJson({ saved: true, state, client: client.name, version: row.version, problems: args.submit ? [] : problems, url });
      } catch (err) {
        console.error("[mcp] save_agent_client_addition failed", err);
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

  server.registerTool(
    "propose_agent_change",
    {
      title: "Propose a change to this agent's instructions",
      description: [
        "Records something this run taught you that the agent's instructions should say (a missing rule, wording that misled you), for a person to turn into a draft or dismiss on the agent's screen. Name the block it is about when you know it.",
        "It changes nothing by itself: the instructions stay as they are until a draft is written and a manager approves it.",
      ].join(" "),
      inputSchema: z.object({
        installation: z.string().min(1).max(60).describe("The installation id from the bootstrap text."),
        lesson: z.string().min(1).max(2000).describe("What to change and why, in plain Hebrew."),
        block: z.string().max(40).optional().describe("The key of the block it is about, if known."),
      }),
      annotations: TOOL_ANNOTATIONS.propose_agent_change,
    },
    async (args: { installation: string; lesson: string; block?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const row = await proposeLesson(actor, args.installation.trim(), { text: args.lesson, blockKey: args.block });
        return toolJson({ proposed: true, lessonId: row.id, state: "open: waits for a person on the agent's screen" });
      } catch (err) {
        console.error("[mcp] propose_agent_change failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "install_agent",
    {
      title: "Install an Ankora agent for this person",
      description: [
        "Creates an installation of an Ankora agent for the signed-in person and returns its bootstrap text: the only lines to put in the Claude project's instructions, the scheduled task's prompt or the first message of a persistent conversation.",
        "Pass the agent's slug, where it will run, and its clients by name (or allClients). Installation-level values go in `values`, by parameter key.",
        "Start with preview: true: it installs nothing and returns everything the install needs: `ask` (must be answered: clients, the schedule of a scheduled run, required values), `optional` (values the user may give now), `clientGaps` (client values a manager has not set) and `requirements` (what the Claude account must have connected).",
        "Then ask the user every `ask` item and offer the `optional` ones in ONE message, together with where it runs. Tell them about `clientGaps` and `requirements`. Call again without preview only with all the answers. A call that still misses an `ask` item installs nothing and returns the same lists.",
      ].join(" "),
      inputSchema: z.object({
        agent: z.string().min(1).max(60).describe("The agent's slug, from its url."),
        surface: z.enum(["PROJECT", "SCHEDULED", "PERSISTENT_SESSION", "SKILL"]),
        clients: z.array(z.string().max(120)).max(50).optional().describe("Client names, as the user has them in Ankora."),
        allClients: z.boolean().optional().describe("Every client this person has access to."),
        checkEvery: z.enum(["RUN", "DAILY", "WEEKLY"]).optional().describe("How often to look for a newer version. Default DAILY."),
        schedule: z.object({ cron: z.string().max(120), tz: z.string().max(60) }).optional().describe("For a scheduled run: its cron and time zone."),
        claudeAccount: z.string().max(120).optional().describe("The Claude account it runs in, when not the person's own."),
        values: z.record(z.string().max(40), z.string().max(2000)).optional(),
        preview: z.boolean().optional().describe("True: install nothing, only return what the install needs."),
      }),
      annotations: TOOL_ANNOTATIONS.install_agent,
    },
    async (
      args: { agent: string; surface: "PROJECT" | "SCHEDULED" | "PERSISTENT_SESSION" | "SKILL"; clients?: string[]; allClients?: boolean; checkEvery?: "RUN" | "DAILY" | "WEEKLY"; schedule?: { cron: string; tz: string }; claudeAccount?: string; values?: Record<string, string>; preview?: boolean },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        const agent = await prisma.agent.findUnique({ where: { slug: args.agent.trim() }, select: { id: true, slug: true, name: true, archivedAt: true } });
        if (!agent || agent.archivedAt) return toolText(`No agent with the slug "${args.agent}". Nothing was installed.`);
        let clientIds: string[] = [];
        if (!args.allClients) {
          const mine = await listAccessibleClients(actor);
          for (const name of args.clients ?? []) {
            const c = mine.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
            if (!c) return toolText(`No client you can access is named "${name}". Nothing was installed.`);
            clientIds.push(c.id);
          }
          clientIds = [...new Set(clientIds)];
        }
        const scope = {
          surface: args.surface,
          clientScope: (args.allClients ? "ALL_MINE" : clientIds.length > 1 ? "LIST" : "ONE") as "ALL_MINE" | "LIST" | "ONE",
          clientIds,
          values: args.values,
          schedules: args.schedule ? [args.schedule] : [],
        };
        const needs = await installQuestions(actor, agent.id, scope);
        if (args.preview || needs.ask.length > 0) {
          return toolJson({
            installed: false,
            ...needs,
            next: needs.ask.length > 0
              ? "Nothing was installed. Ask the user every `ask` item and offer the `optional` ones in one message, tell them about `clientGaps` and `requirements`, then call install_agent again with all the answers."
              : "Nothing was installed (preview). Offer the user the `optional` values, tell them about `clientGaps` and `requirements`, confirm where it runs and on which clients, then call install_agent again without preview.",
          });
        }
        const inst = await createInstallation(actor, { agentId: agent.id, ...scope, checkEvery: args.checkEvery ?? "DAILY", claudeAccount: args.claudeAccount ?? null });
        return toolJson({
          installed: true,
          installation: inst.id,
          bootstrap: bootstrapText(agent, inst.id),
          url: agentUrl(agent.slug, "installations"),
          clientGaps: needs.clientGaps,
          requirements: needs.requirements,
          next: "Give the user the bootstrap text to paste in place of the old instructions. Tell them about any clientGaps (a manager sets those on the agent's parameters tab; until then the run skips that client) and to check every requirement is connected in that Claude account.",
        });
      } catch (err) {
        console.error("[mcp] install_agent failed", err);
        return toolFailure(err);
      }
    }
  );
}

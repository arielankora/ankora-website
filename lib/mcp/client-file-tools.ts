import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";
import { proposeKnowledge, type ProposalItemInput } from "@/lib/app-domain/knowledge-proposals";
import { lookupContact } from "@/lib/app-domain/client-contacts";
import { extractionBrief } from "@/lib/app-domain/extraction-brief";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { listMyRoutines, recordProcessCheck } from "@/lib/app-domain/process-checks";
import { mcpGetProcess, mcpListPolicies, mcpListProcesses } from "@/lib/app-domain/mcp-processes";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/email-templates";

/// A process of one client, by its code ("P3") or its title, the way the
/// user says it. One match or a sentence saying why not.
async function resolveProcess(client: { id: string; name: string }, query: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const q = query.trim();
  const candidates = await prisma.process.findMany({
    where: { clientId: client.id, deletedAt: null, status: { not: "RETIRED" } },
    select: { id: true, code: true, title: true },
  });
  const exact = candidates.filter((p) => p.code.toLowerCase() === q.toLowerCase() || p.title === q);
  const loose = exact.length ? exact : candidates.filter((p) => p.title.includes(q));
  if (loose.length === 1) return { ok: true, id: loose[0].id };
  return {
    ok: false,
    message:
      loose.length === 0
        ? `No process "${q}" for ${client.name}. Processes: ${candidates.map((p) => `${p.code} ${p.title}`).join("; ") || "none yet"}.`
        : `"${q}" matches several processes: ${loose.map((p) => `${p.code} ${p.title}`).join("; ")}. Ask which one.`,
  };
}

// Org brain, phase 2 (claude/org-brain-spec-2026-10-12.md, 6.3 and 8): the
// client file, for Claude.
//
// The same document as the "תיק הלקוח" screen, built by the same code,
// in its "ai" version: no emails, phones, card digits or vault names, and
// nothing marked sensitive. Each item's audience is applied for the
// signed-in person before anything reaches here, so Claude never sees
// what that person could not.
//
// Markdown rather than JSON on purpose: it is read, not parsed, and every
// line already carries its status and its sources in the notation the
// people who wrote it use.

export function registerClientFileTools(server: McpServer): void {
  server.registerTool(
    "get_client_file",
    {
      title: "Get client file",
      description:
        "Returns a client's file as one Markdown document, in Ankora's standard order: identity and legal entities, scope, people, preferences, requirements, the client's rules (follow them; a proposed rule's interim rule applies until it is approved), systems and access, suppliers, processes (with each one's approved procedure, completeness and gaps), finance, communication, dates, temporary information, one-off decisions, open questions, items awaiting confirmation, recent updates, and the source legend. Lines not yet confirmed say so, with what would confirm them; sources appear as [S1 08:13]. Contact details and sensitive items are left out. Read it before working on a client you have not worked on in this conversation, and before drafting anything to the client or their suppliers.",
      inputSchema: z.object({ client: z.string().describe("Client name, as the user said it.") }),
      annotations: TOOL_ANNOTATIONS.get_client_file,
    },
    async (args: { client: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const doc = await buildClientFile(actor, client.value.id, { audience: "ai" });
        return toolText(toMarkdown(doc));
      } catch (err) {
        console.error("[mcp] get_client_file failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "propose_knowledge",
    {
      title: "Propose knowledge for a client file",
      description: [
        "Sends a batch of proposed items for a client's file, from ONE source (a meeting or a document). Nothing enters the file until a person approves each item on Ankora's review screen; there is no tool that approves.",
        "Source: pass `sourceCode` (\"S3\") if the source is already in the client's register (get_client_file lists it), or `newSource` to register it. A recording is found again by its `firefliesId`, so sending the same meeting twice does not create a second source.",
        "Each item: `target` FACT | CONTACT | ORGANIZATION | SYSTEM | REQUEST_TYPE | POLICY, `payload` with that item's fields, `at` (minute in the recording, \"08:13\"), `reason` (one sentence), and optionally `quote` (short; never from a topics-only source).",
        "FACT payload: kind (SCOPE_IN, SCOPE_OUT, PREFERENCE, REQUIREMENT, LOCATION, FINANCE, TEMPORARY, ONE_OFF_DECISION, QUESTION, NOTE), body, and as relevant topic, referTo, validUntil or validUntilEvent (TEMPORARY needs one), decidedAt (ONE_OFF_DECISION needs it), decidedBy.",
        "CONTACT payload: name and/or role, relationship (CLIENT_STAFF, PROVIDER, ADVISOR, INVESTOR, SUPPLIER), emails, phones, organizationName, context, channelOrder, isPrimary, isDecisionMaker.",
        "ORGANIZATION payload: name, domains, role, relationship, monthlyCostMinor (agorot or cents), currency, notes. SYSTEM payload: systemName, purpose, url, accountUsed, ourPermission, accessStatus, blocker, clientAdmin, notes. REQUEST_TYPE payload (what comes in, from whom, and how it is answered): title, fromWho, arrivesVia, handling.",
        "POLICY payload (a rule the client set): kind (DATA_HANDLING what may enter the file, DISCLOSURE who must not be told what, COMMUNICATION, SEPARATION, APPROVAL_REQUIRED, THRESHOLD, REQUIRED_STEP, TIMING, FORBIDDEN, INFO), title, statement, rationale, and for THRESHOLD and APPROVAL_REQUIRED an interimStatement: the careful rule that applies until a manager approves it. A rule enters the file as proposed; it binds once a manager approves it.",
        "Every payload may carry knowledgeStatus (CONFIRMED only if the client or their supplier said or showed it explicitly; UNCERTAIN with toResolve otherwise) and sensitivity. Set sensitivity SENSITIVE for medical, political or personal information, or whatever the client's data-handling rules call sensitive: such an item is shown and decided only by the client's approvers for sensitive information, and never leaves the product through MCP once in the file.",
        "To change an existing fact, set action SUPERSEDE (the client changed it) or CONTRADICT (someone said otherwise; nothing is overwritten) with `targetId` from the file.",
        "Never include passwords, keys or card numbers: such items are dropped and a task to change the secret is opened. Leave out small talk, momentary technical issues, guesses, and Ankora's own commercial terms.",
      ].join(" "),
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        sourceCode: z.string().optional().describe("An existing source code in the client's register, e.g. S3."),
        newSource: z
          .object({
            kind: z.enum(["TRANSCRIPT", "CLIENT_DOCUMENT", "TASK", "PERSON", "ANKORA_DOCUMENT"]),
            title: z.string(),
            date: z.string().optional().describe("YYYY-MM-DD"),
            participants: z.array(z.string()).optional(),
            firefliesId: z.string().optional(),
            documentId: z.string().optional().describe("For a document in the client's file (list_documents)."),
            topicsOnly: z.boolean().optional().describe("True for a restricted meeting: topics only, no quotes."),
          })
          .optional(),
        note: z.string().optional().describe("One line: what was read, what was left out."),
        items: z
          .array(
            z.object({
              target: z.enum(["FACT", "CONTACT", "ORGANIZATION", "SYSTEM", "REQUEST_TYPE", "POLICY"]),
              action: z.enum(["CREATE", "SUPERSEDE", "CONTRADICT"]).optional(),
              targetId: z.string().optional(),
              payload: z.record(z.string(), z.unknown()),
              at: z.string().optional(),
              alsoSources: z.array(z.string()).optional(),
              reason: z.string().optional(),
              quote: z.string().optional(),
            })
          )
          .min(1)
          .max(60),
      }),
      annotations: TOOL_ANNOTATIONS.propose_knowledge,
    },
    async (
      args: {
        client: string;
        sourceCode?: string;
        newSource?: { kind: "TRANSCRIPT" | "CLIENT_DOCUMENT" | "TASK" | "PERSON" | "ANKORA_DOCUMENT"; title: string; date?: string; participants?: string[]; firefliesId?: string; documentId?: string; topicsOnly?: boolean };
        note?: string;
        items: ProposalItemInput[];
      },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        if (!args.sourceCode && !args.newSource) return toolText("Say where this comes from: pass `sourceCode` for a source already in the register, or `newSource`.");
        const ns = args.newSource;
        if (ns?.date && !/^\d{4}-\d{2}-\d{2}$/.test(ns.date)) return toolText("newSource.date must be YYYY-MM-DD.");
        const result = await proposeKnowledge(actor, {
          clientId: client.value.id,
          source: args.sourceCode
            ? { code: args.sourceCode }
            : {
                kind: ns!.kind,
                title: ns!.title,
                occurredAt: ns!.date ? new Date(`${ns!.date}T00:00:00Z`) : null,
                participants: ns!.participants,
                externalIds: [ns!.firefliesId, ns!.documentId].filter((v): v is string => !!v),
                restriction: ns!.topicsOnly ? "TOPICS_ONLY" : "NONE",
              },
          note: args.note,
          via: "MCP",
          items: args.items,
        });
        return toolJson({
          ...result,
          next:
            result.proposed > 0
              ? `${result.proposed} proposals are waiting for a person to approve them on Ankora's review screen (/app/knowledge). Nothing is in the file yet.`
              : "Nothing was proposed.",
        });
      } catch (err) {
        console.error("[mcp] propose_knowledge failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "lookup_contact",
    {
      title: "Look up a contact",
      description:
        "Who is behind one email address or phone number: their name, and for each of the user's clients whose file has them, their role there, relationship (client staff, provider, advisor...) and organization. Use it to know who wrote a message or who is on a call. It returns no other contact details and never a client the user cannot reach; an empty list means nobody in the user's clients' files has that address or number.",
      inputSchema: z.object({ query: z.string().describe("One email address or one phone number.") }),
      annotations: TOOL_ANNOTATIONS.lookup_contact,
    },
    async (args: { query: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const matches = await lookupContact(actor, args.query);
        return toolJson({ count: matches.length, matches });
      } catch (err) {
        console.error("[mcp] lookup_contact failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_processes",
    {
      title: "List a client's processes",
      description:
        "The client's processes (P1, P2...), one line each: what it is for, its triggers, owner and backup, where it stands in the handover, how complete its documentation is (out of the 9 fields), whether it needs review and why, the approved procedure's version, the next date and the last run. Use get_process for the steps. Sensitive processes, and restricted ones the user is not named on, are left out.",
      inputSchema: z.object({ client: z.string().describe("Client name, as the user said it.") }),
      annotations: TOOL_ANNOTATIONS.list_processes,
    },
    async (args: { client: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const processes = await mcpListProcesses(actor, client.value.id);
        return toolJson({ client: client.value.name, count: processes.length, processes });
      } catch (err) {
        console.error("[mcp] list_processes failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "get_process",
    {
      title: "Get a process and its procedure",
      description:
        "One of a client's processes in full: everything list_processes says, plus the SLA, who executes it today, the approver, the external party, the exception playbook, the gaps, the approved procedure step by step (mode, business day, actions, systems, output, how a person verifies an automated step, whether it needs approval, the most it moves, the channel), what in it fails the client's rules today, and the last five runs. Follow the approved procedure; a step marked as needing approval waits for a person. If the procedure fails a rule, say so before acting.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        process: z.string().describe('The process code ("P3") or its title.'),
      }),
      annotations: TOOL_ANNOTATIONS.get_process,
    },
    async (args: { client: string; process: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const process = await resolveProcess(client.value, args.process);
        if (!process.ok) return toolText(process.message);
        const detail = await mcpGetProcess(actor, client.value.id, process.id);
        if (!detail) return toolText(`No process "${args.process}" for ${client.value.name}.`);
        return toolJson(detail);
      } catch (err) {
        console.error("[mcp] get_process failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_policies",
    {
      title: "List the rules for a client",
      description:
        "The rules that bind work for a client. `ankora`: Ankora's own rules, the same for every client. `clientRules`: the client's rules as they apply today: the rule in force (for a proposed rule with an interim rule, the interim one applies until a manager approves), what the server checks against procedures, why, who must not be told, and approved exceptions with their end date. Follow them when preparing anything for the client; when a rule forbids what the user asks, say so and suggest requesting an exception. Sensitive rules, and restricted ones the user is not named on, are left out.",
      inputSchema: z.object({ client: z.string().describe("Client name, as the user said it.") }),
      annotations: TOOL_ANNOTATIONS.list_policies,
    },
    async (args: { client: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        return toolJson({ client: client.value.name, ...(await mcpListPolicies(actor, client.value.id)) });
      } catch (err) {
        console.error("[mcp] list_policies failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "start_process",
    {
      title: "Start a run of a process",
      description:
        "Opens a run of one of a client's processes (get_client_file lists them as P1, P2... in section 7.4): a task with the approved procedure's steps, each due on its business day, assigned to the process's owner. Use it when something happened that the process answers (an employee's trip, a request) or when the user asks. Confirm the process and the date with the user first: every call opens another run. A process without an approved procedure, a paused one, or an ongoing one cannot be started.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        process: z.string().describe('The process code ("P3") or its title.'),
        date: z.string().describe("The day the run is for, YYYY-MM-DD."),
      }),
      annotations: TOOL_ANNOTATIONS.start_process,
    },
    async (args: { client: string; process: string; date: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) return toolText("date must be YYYY-MM-DD.");
        const process = await resolveProcess(client.value, args.process);
        if (!process.ok) return toolText(process.message);
        const run = await startProcessRun(actor, process.id, new Date(`${args.date}T00:00:00Z`));
        return toolJson({ taskId: run.id, title: run.title, link: `${appBaseUrl()}/app/tasks/${run.id}` });
      } catch (err) {
        console.error("[mcp] start_process failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_my_routines",
    {
      title: "List my routine",
      description:
        "The ongoing processes the user owns or backs up, across their clients: what each one is, how often it is checked and what is checked, when the next check is due (OVERDUE, DUE today, or LATER), and the steps of its approved procedure. Ongoing processes open no tasks, so this is where that work is. Use it when the user asks what is on their routine, or before recording a check.",
      inputSchema: z.object({}),
      annotations: TOOL_ANNOTATIONS.list_my_routines,
    },
    async (_args: Record<string, never>, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const routines = await listMyRoutines(actor);
        return toolJson({
          count: routines.length,
          routines: routines.map((r) => ({
            client: r.clientName,
            process: `${r.code} ${r.title}`,
            check: r.checkEvery ? `${r.checkEvery}${r.checkText ? `: ${r.checkText}` : ""}` : null,
            lastChecked: r.lastCheckedAt ? r.lastCheckedAt.toISOString().slice(0, 10) : null,
            nextCheck: r.dueKey,
            state: r.state,
            asBackup: r.asBackup,
            steps: r.steps,
          })),
        });
      } catch (err) {
        console.error("[mcp] list_my_routines failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "record_process_check",
    {
      title: "Record a check of an ongoing process",
      description:
        "Writes down that the user checked one of a client's ongoing processes, and what they found. outcome OK: a line in the process's history, nothing else. outcome ISSUE: say what was found in note (required); it also opens a task for the user, due today, with the note. Confirm the outcome and the note with the user first: every call is another check, and an issue is another task. Only an ongoing process that is not paused or retired can be checked.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        process: z.string().describe('The process code ("P5") or its title.'),
        outcome: z.enum(["OK", "ISSUE"]),
        note: z.string().optional().describe("What was found. Required for ISSUE."),
      }),
      annotations: TOOL_ANNOTATIONS.record_process_check,
    },
    async (args: { client: string; process: string; outcome: "OK" | "ISSUE"; note?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const process = await resolveProcess(client.value, args.process);
        if (!process.ok) return toolText(process.message);
        const { check, task } = await recordProcessCheck(actor, process.id, { outcome: args.outcome, note: args.note ?? null });
        return toolJson({
          checkId: check.id,
          outcome: check.outcome,
          task: task ? { taskId: task.id, title: task.title, link: `${appBaseUrl()}/app/tasks/${task.id}` } : null,
        });
      } catch (err) {
        console.error("[mcp] record_process_check failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "get_extraction_brief",
    {
      title: "Get the extraction brief",
      description: [
        "Everything an extraction run needs before reading a meeting: Ankora's approved extraction guidance (follow it), the user's clients with the email domains that identify their meetings and each client's own data-handling rules, and the Fireflies recordings already turned into proposals in the last 30 days (skip those).",
        "A client's `dataHandlingRules` bind every item proposed for that client, on top of Ankora's guidance: what they do not allow is not proposed at all. A rule marked as an interim rule applies as written until its proposed rule is approved.",
        "Matching a meeting to a client: a participant from a CLIENT domain decides it. A PARTNER domain decides it only when that partner appears under one client; if it appears under several, decide from the title and content and say why in the batch note. A meeting about several clients is split: each item goes to its own client's batch. A meeting with no client participant and no client named is internal: skip it.",
      ].join(" "),
      inputSchema: z.object({}),
      annotations: TOOL_ANNOTATIONS.get_extraction_brief,
    },
    async (_args: Record<string, never>, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        return toolJson(await extractionBrief(actor));
      } catch (err) {
        console.error("[mcp] get_extraction_brief failed", err);
        return toolFailure(err);
      }
    }
  );
}

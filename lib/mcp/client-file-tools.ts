import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { actorOf, findTask, TASK_ARGS } from "@/lib/mcp/task-extra-tools";
import { recordRunLesson } from "@/lib/app-domain/process-lessons";
import { LESSON_QUESTION } from "@/lib/process-lessons";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";
import { proposeKnowledge, type ProposalItemInput } from "@/lib/app-domain/knowledge-proposals";
import { proposeAwaitingAssignment } from "@/lib/app-domain/batch-assignment";
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
        "Each item: `target` FACT | CONTACT | ORGANIZATION | SYSTEM | REQUEST_TYPE | POLICY | ENTITY | NARRATIVE | PROCESS | DOMAIN | TASK, `payload` with that item's fields, `at` (minute in the recording, \"08:13\"), `reason` (one sentence: why it is true and where it was said; required), `confidence` (HIGH, MEDIUM or LOW: how sure you are; the review screen orders by it, lowest first), and optionally `quote` (short; never from a topics-only source).",
        "FACT payload: kind (SCOPE_IN, SCOPE_OUT, PREFERENCE, REQUIREMENT, LOCATION, FINANCE, TEMPORARY, ONE_OFF_DECISION, QUESTION, NOTE), body, and as relevant topic, referTo, validUntil or validUntilEvent (TEMPORARY needs one), decidedAt (ONE_OFF_DECISION needs it), decidedBy, and for a PREFERENCE subjectName: whose preference it is (a contact or a firm in the file, by name).",
        "CONTACT payload: name and/or role, relationship (CLIENT_STAFF, PROVIDER, ADVISOR, INVESTOR, SUPPLIER), emails, phones, organizationName, context, channelOrder, isPrimary, isDecisionMaker, entityName (the client's legal entity they work with).",
        "ORGANIZATION payload: name, domains, role, relationship, monthlyCostMinor (agorot or cents), currency, notes. SYSTEM payload: systemName, purpose, url, accountUsed, ourPermission, accessStatus, blocker, clientAdmin, notes, entityName, and how it is billed: billingCycle (MONTHLY, ANNUAL, OTHER), billingCostMinor (agorot or cents), billingCurrency (ILS, USD, EUR), cardLast4 (the last four digits only, never more), invoiceTo (where the invoice arrives). REQUEST_TYPE payload (what comes in, from whom, and how it is answered): title, fromWho, arrivesVia, handling, routeToNames (the contacts it goes to, by name), processName (the process it sets off, by code like P3 or title), entityName.",
        "POLICY payload (a rule the client set): kind (DATA_HANDLING what may enter the file, DISCLOSURE who must not be told what, COMMUNICATION, SEPARATION, APPROVAL_REQUIRED, THRESHOLD, REQUIRED_STEP, TIMING, FORBIDDEN, INFO), title, statement, rationale, and for THRESHOLD and APPROVAL_REQUIRED an interimStatement: the careful rule that applies until a manager approves it. effectiveFrom and reviewBy (YYYY-MM-DD) when the client said from when it holds, or when it should be looked at again. params (and interimParams for the interim rule) when the rule says something the server can check: amountMinor and currency (THRESHOLD), appliesToTags (step tags such as PAYMENT, CLIENT_MESSAGE), leadBusinessDays (TIMING), channels and invoiceTo (COMMUNICATION), mustInclude (REQUIRED_STEP), entityName for a rule of one entity, entityNames for the entities a SEPARATION rule keeps apart. A rule enters the file as proposed; it binds once a manager approves it.",
        "ENTITY payload (a legal entity of the client): name, legalName, registrationNumber, country, currency, billingAddress, parentName (an entity already in the file). NARRATIVE payload: kind (OVERVIEW the client in a paragraph, BACKGROUND, OUR_ROLE what Ankora does for them) and body: the WHOLE new text, which replaces the current one; cite sources inside it as [S1 08:13]. PROCESS payload (something that recurs; a one-time project is a task, not a process): title, purpose, triggerKinds (SCHEDULED, EVENT, ON_DEMAND, CONTINUOUS), triggerText, slaText, externalPartyText, approverText, approvalText, exceptionPlaybook, executorText (who does it today), transitionStatus (WITH_CLIENT, IN_HANDOVER, WITH_ANKORA, NOT_PLANNED), entityName, externalPartyNames (the outside contacts, by name), systemNames (the systems it needs, by name as in the file), approverName (a person at Ankora or a contact), approvalPolicyTitles (the client's approval rules, by title), and steps when the procedure was described: title, mode (MANUAL, ASSISTED, AUTOMATED), offsetBusinessDays, actionTags, systemNames, output, verification, requiresApproval. It enters as a draft; a manager approves the procedure separately. DOMAIN payload: domain, kind (CLIENT their own, PARTNER a supplier's), organizationName for a partner.",
        "TASK payload (something someone has to DO, not something to know about the client: a document to send, a call to set up, a check promised in the meeting): title (an action, e.g. \"Send Dana the updated contract\"), and as said: description, dueDate (YYYY-MM-DD), assigneeName (the person at Ankora), priority (LOW, NORMAL, HIGH, URGENT). Approving it opens a task on the client, with the reason, quote and moment in the recording; it never enters the file. Never put an action item in a FACT. What the same moment teaches about the client (a preference, a rule) is a separate item. A task is read by everyone on the client: nothing sensitive goes in one. No knowledgeStatus, ownerName or clientVisible on a TASK.",
        "Names (entityName, routeToNames, systemNames and the like) are linked to the item in the file with that name when the proposal is approved; one that matches nothing, or more than one, is flagged on the card and left unlinked. Name only what is in the file or proposed in the same batch.",
        "Every payload except NARRATIVE, DOMAIN, TASK and a QUESTION fact must carry knowledgeStatus (CONFIRMED only if the client or their supplier said or showed it explicitly; UNCERTAIN or MISSING with toResolve otherwise); an item without it, or without a reason, is dropped and the reply says why. Payloads may also carry sensitivity. Set sensitivity SENSITIVE for medical, political or personal information, or whatever the client's data-handling rules call sensitive: such an item is shown and decided only by the client's approvers for sensitive information, and never leaves the product through MCP once in the file.",
        "Every payload except NARRATIVE, DOMAIN and TASK may also carry externalRefs: where the item lives in the team's other registers, as said or written (an array like [\"RAID-002\", \"HND-014\", \"ClickUp:86c1x\"]). Every payload except NARRATIVE, DOMAIN and TASK may also carry ownerName (the person at Ankora who keeps the item right, by name; for a PROCESS, its owner) and clientVisible: true only when the client said it, or it is theirs to see (their own systems, their request types, a rule they set). Leave it out otherwise; never for anything sensitive or with doNotDisclose.",
        "To change an item already in the file, set action SUPERSEDE with `targetId`: the id printed after the item in get_client_file, as (id: ...). For a fact it writes a new version beside the old one. For a CONTACT, ORGANIZATION, SYSTEM, REQUEST_TYPE, POLICY, ENTITY or PROCESS the payload carries only the fields that changed (an organization's name never changes), plus knowledgeStatus; the rest stays as it is, the sources are added to the item's, a changed rule goes back to proposed until a manager approves it, and new PROCESS steps become a new draft procedure. When someone said otherwise about an item and it is not clear which is right, use CONTRADICT with its targetId and a payload of what was said: nothing is overwritten; a fact keeps both versions, any other item becomes uncertain with what was said as what would close it. Never propose a second item for something already in the file.",
        "Never include passwords, keys or card numbers: such items are dropped and a task to change the secret is opened. Leave out small talk, momentary technical issues, guesses, and Ankora's own commercial terms.",
        "Whose meeting it is: a participant from a client's domain decides; so does a partner linked to one client only. A meeting about several clients (a supplier reviewing two of them): give each item its own `client`, and each goes only to that client's file, with the meeting registered in each one's register (newSource, not sourceCode). A partner linked to several clients and nobody on the call who decides: do not guess. Pass `client` as the one you think, and `uncertain` with all the clients it could be and the reason; nothing enters any file, and the batch waits until a person picks the client on the review screen.",
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
            taskId: z.string().optional().describe("For kind TASK: the task the knowledge came out of, such as a mapping task."),
            topicsOnly: z.boolean().optional().describe("True for a restricted meeting: topics only, no quotes."),
          })
          .optional(),
        note: z.string().optional().describe("One line: what was read, what was left out."),
        uncertain: z
          .object({
            candidates: z.array(z.string()).min(2).max(6).describe("Every client the meeting could belong to, by name, including `client`."),
            reason: z.string().describe("Why `client` is the likely one: what in the title or the content points to it."),
          })
          .optional()
          .describe("Only when it is not clear whose meeting this is. Needs newSource of kind TRANSCRIPT."),
        items: z
          .array(
            z.object({
              target: z.enum(["FACT", "CONTACT", "ORGANIZATION", "SYSTEM", "REQUEST_TYPE", "POLICY", "ENTITY", "NARRATIVE", "PROCESS", "DOMAIN", "TASK"]),
              action: z.enum(["CREATE", "SUPERSEDE", "CONTRADICT"]).optional(),
              targetId: z.string().optional(),
              payload: z.record(z.string(), z.unknown()),
              at: z.string().optional(),
              alsoSources: z.array(z.string()).optional(),
              reason: z.string().optional(),
              quote: z.string().optional(),
              confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
              client: z.string().optional().describe("For a meeting about several clients: this item's client, by name. Defaults to `client`."),
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
        newSource?: { kind: "TRANSCRIPT" | "CLIENT_DOCUMENT" | "TASK" | "PERSON" | "ANKORA_DOCUMENT"; title: string; date?: string; participants?: string[]; firefliesId?: string; documentId?: string; taskId?: string; topicsOnly?: boolean };
        note?: string;
        uncertain?: { candidates: string[]; reason: string };
        items: (ProposalItemInput & { client?: string })[];
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
        const newSource = ns
          ? {
              kind: ns.kind,
              title: ns.title,
              occurredAt: ns.date ? new Date(`${ns.date}T00:00:00Z`) : null,
              participants: ns.participants,
              externalIds: [ns.firefliesId, ns.documentId, ns.taskId].filter((v): v is string => !!v),
              restriction: ns.topicsOnly ? ("TOPICS_ONLY" as const) : ("NONE" as const),
            }
          : null;
        const items = args.items.map(({ client: _client, ...item }) => item);

        // Spec 5.1, step 3: not clear whose meeting it is.
        if (args.uncertain) {
          if (args.items.some((i) => i.client)) return toolText("`uncertain` is for a meeting of one client that is not clear. A meeting about several clients sets `client` on each item instead.");
          if (!newSource || newSource.kind !== "TRANSCRIPT") return toolText("`uncertain` needs `newSource` of kind TRANSCRIPT: a waiting meeting is in no client's register yet.");
          const candidateIds: string[] = [];
          for (const name of args.uncertain.candidates) {
            const c = await lookupClient(actor, name);
            if (!c.ok) return toolText(c.message);
            candidateIds.push(c.value.id);
          }
          const waiting = await proposeAwaitingAssignment(actor, {
            proposedClientId: client.value.id,
            candidateClientIds: candidateIds,
            reason: args.uncertain.reason,
            source: newSource,
            note: args.note,
            items,
          });
          return toolJson({
            ...waiting,
            next:
              waiting.waiting > 0
                ? `${waiting.waiting} items are waiting for a person to say whose meeting this was, on Ankora's review screen (/app/knowledge). They enter no file, and no register, until then.`
                : "Nothing was kept.",
          });
        }

        // Spec 5.1, step 4: a meeting about several clients, item by item.
        const groups = new Map<string, { id: string; name: string; items: ProposalItemInput[]; indexes: number[] }>();
        for (const [index, item] of args.items.entries()) {
          let target = client.value;
          if (item.client && item.client.trim() !== args.client.trim()) {
            const c = await lookupClient(actor, item.client);
            if (!c.ok) return toolText(`Item ${index}: ${c.message}`);
            target = c.value;
          }
          const g = groups.get(target.id) ?? { id: target.id, name: target.name, items: [], indexes: [] };
          g.items.push(items[index]);
          g.indexes.push(index);
          groups.set(target.id, g);
        }
        if (groups.size > 1 && !newSource) return toolText("A meeting about several clients needs `newSource`: a source code belongs to one client's register.");
        const batches = [];
        for (const g of groups.values()) {
          const result = await proposeKnowledge(
            actor,
            { clientId: g.id, source: args.sourceCode && groups.size === 1 ? { code: args.sourceCode } : newSource!, note: args.note, via: "MCP", items: g.items },
            { indexes: g.indexes }
          );
          batches.push({ client: g.name, ...result });
        }
        const proposed = batches.reduce((n, b) => n + b.proposed, 0);
        const next =
          proposed > 0
            ? `${proposed} proposals are waiting for a person to approve them on Ankora's review screen (/app/knowledge). Nothing is in the file yet.`
            : "Nothing was proposed.";
        return toolJson(batches.length === 1 ? { ...batches[0], next } : { batches, next });
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
        "One of a client's processes in full: everything list_processes says, plus the SLA, who executes it today, the approver, the external party, the exception playbook, the gaps, the approved procedure step by step (mode, business day, actions, systems, output, how a person verifies an automated step, whether it needs approval, the most it moves, the channel), what in it fails the client's rules today, the last five runs, and the open lessons people left when closing runs (read them before drafting a new version). Follow the approved procedure; a step marked as needing approval waits for a person. If the procedure fails a rule, say so before acting.",
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
        "The rules that bind work for a client. `ankora`: Ankora's own rules, the same for every client. `clientRules`: the client's rules as they apply today: the rule in force (for a proposed rule with an interim rule, the interim one applies until a manager approves), what the server checks against procedures, why, who must not be told, `dates` (the day it starts to bind and its review date; a rule that starts later does not bind yet), and approved exceptions with their end date. Follow them when preparing anything for the client; when a rule forbids what the user asks, say so and suggest requesting an exception. Sensitive rules, and restricted ones the user is not named on, are left out.",
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
    "record_run_lesson",
    {
      title: "Record what a run taught about its procedure",
      description: `For a run of a process that is done (a task opened from the process), the answer to "${LESSON_QUESTION}": what in the procedure was wrong or missing, in the user's words, or \`nothing\` true when it held. It goes to the process's owner, who decides whether it goes into the next version; it changes no procedure by itself. One answer per run. Only after the user confirms the wording.`,
      inputSchema: z.object({
        ...TASK_ARGS,
        lesson: z.string().max(2000).optional().describe("What in the procedure was wrong or missing."),
        nothing: z.boolean().optional().describe("True when the procedure held and there is nothing to change."),
      }),
      annotations: TOOL_ANNOTATIONS.record_run_lesson,
    },
    async (args: { task?: string; taskId?: string; client?: string; lesson?: string; nothing?: boolean }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        if (!args.nothing && !args.lesson?.trim()) return toolText("Pass `lesson` with what was wrong or missing, or `nothing: true`.");
        if (args.nothing && args.lesson?.trim()) return toolText("Pass either `lesson` or `nothing: true`, not both.");
        const task = await findTask(actor, { ...args, includeDone: true });
        if (!task.ok) return toolText(task.message);
        const lesson = await recordRunLesson(actor, task.value.id, args.nothing ? null : args.lesson!);
        return toolJson({ recorded: lesson.status === "OPEN" ? "lesson" : "nothing", next: lesson.status === "OPEN" ? "The process's owner will see it on the client's processes screen." : null });
      } catch (err) {
        console.error("[mcp] record_run_lesson failed", err);
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

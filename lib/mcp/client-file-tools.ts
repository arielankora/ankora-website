import "server-only";
import { aiExcludedClientIds, isDocumentAiExcluded, isTaskAiExcluded } from "@/lib/app-domain/ai-exclusion-db";
import { AI_EXCLUDED_TOOL_MESSAGE } from "@/lib/ai-exclusion";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { actorOf, findTask, TASK_ARGS } from "@/lib/mcp/task-extra-tools";
import { recordRunLesson } from "@/lib/app-domain/process-lessons";
import { LESSON_QUESTION } from "@/lib/process-lessons";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { publishAs, publishedInput } from "@/lib/mcp/proposal-schema";
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
import { clientBrief, clientFileChanges } from "@/lib/app-domain/client-file-live";
import { readSince } from "@/lib/client-file-live";
import { appBaseUrl } from "@/lib/email-templates";
import { saveProcedureTranslation, translationSource } from "@/lib/app-domain/procedure-documents";

/// Ceilings on the list-shaped inputs of this file's tools (security
/// review, 25.10.2026).
///
/// GHSA-mrhx-c7xc-m3w5: zod's array parser collected one issue per failing
/// element, with no cap and no early exit, so an array with no length
/// constraint turned a single authenticated request into an out-of-memory
/// crash. zod 4.6.6 fixes the accumulation; a bound on the schema is what
/// makes the question moot, and it is the right shape for these inputs
/// anyway. lib/mcp/limits.ts holds the matching cap at the SDK layer,
/// which is also what bounds the `z.record` inputs below.
///
/// Each number is well above the widest real call: a meeting has a dozen
/// participants, not fifty, and a procedure has a handful of systems.
const MAX_PARTICIPANTS = 50;
const MAX_ALSO_SOURCES = 20;
const MAX_PROCEDURE_SYSTEMS = 50;
const MAX_PROCEDURE_STEPS = 200;

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

/// propose_knowledge's call, as the SDK validates it. `payload` is any
/// object here on purpose: each item's payload is checked on its own by
/// proposeKnowledge, so one bad item is dropped with its path and the rest
/// go through. What the client is shown is richer: publishedInput adds
/// every target's fields and closed lists, from the same PAYLOADS.
const PROPOSE_INPUT = z.object({
    client: z.string().describe("Client name, as the user said it."),
    sourceCode: z.string().optional().describe("An existing source code in the client's register, e.g. S3."),
    newSource: z
      .object({
        kind: z.enum(["TRANSCRIPT", "CLIENT_DOCUMENT", "TASK", "PERSON", "ANKORA_DOCUMENT", "EMAIL"]),
        title: z.string(),
        date: z.string().optional().describe("YYYY-MM-DD"),
        participants: z.array(z.string()).max(MAX_PARTICIPANTS).optional(),
        firefliesId: z.string().optional(),
        gmailThreadId: z.string().optional().describe("For kind EMAIL: the Gmail thread id, so the same thread is one source."),
        documentId: z.string().optional().describe("For a document in the client's file (list_documents)."),
        taskId: z.string().optional().describe("For kind TASK: the task the knowledge came out of, such as a mapping task."),
        topicsOnly: z.boolean().optional().describe("True for a restricted meeting: topics only, no quotes."),
        clientConversation: z
          .boolean()
          .optional()
          .describe("For kind ANKORA_DOCUMENT only: true when the document writes down what the client said in a conversation with them (an intake summary typed during the meeting). Its items are then not lowered to uncertain just because Ankora wrote them."),
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
          target: z.enum(["FACT", "CONTACT", "ORGANIZATION", "SYSTEM", "REQUEST_TYPE", "POLICY", "ENTITY", "NARRATIVE", "PROCESS", "DOMAIN", "TASK", "DATE"]),
          action: z.enum(["CREATE", "SUPERSEDE", "CONTRADICT"]).optional(),
          targetId: z.string().optional(),
          payload: z.record(z.string(), z.unknown()),
          at: z.string().optional(),
          alsoSources: z.array(z.string()).max(MAX_ALSO_SOURCES).optional(),
          reason: z.string().optional(),
          quote: z.string().optional(),
          confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
          status: z
            .enum(["CONFIRMED", "UNCERTAIN", "MISSING"])
            .optional()
            .describe(
              "CONFIRMED: the client or their supplier said or showed it explicitly. UNCERTAIN: said, but not clearly or not by them (add payload.toResolve). MISSING: needed and not known (add payload.toResolve). Left out: HIGH confidence is CONFIRMED, anything else UNCERTAIN. Not for NARRATIVE, DOMAIN, TASK, DATE or a QUESTION fact."
            ),
          client: z.string().optional().describe("For a meeting about several clients: this item's client, by name. Defaults to `client`."),
        })
      )
      .min(1)
      .max(60),
  });

/// Kept short, with STATUS first: Claude clients cut a tool description
/// after about 4,000 characters (31.10.2026 the cut fell in the middle of
/// the payloads). The fields and their values are in the schema; only what
/// the schema cannot say is here. tests/unit/mcp/propose-knowledge-status
/// holds the length.
export const PROPOSE_KNOWLEDGE_DESCRIPTION = [
  "Sends proposed items for a client's file, from ONE source (a meeting, a document, an email thread). Nothing enters the file until a person approves each item on Ankora's review screen.",
  "STATUS, on each item as `status`: CONFIRMED (the client or their supplier said or showed it explicitly), UNCERTAIN (said unclearly, or only by Ankora) or MISSING (needed, and we do not have it). With UNCERTAIN or MISSING add payload.toResolve: what would close it. Left out, HIGH confidence is CONFIRMED and anything else UNCERTAIN. Not used on NARRATIVE, DOMAIN, TASK, DATE or a QUESTION fact.",
  "FIELDS: each item's `payload` is described in the schema per target (payload.anyOf, titled by target), with every closed list. For example FACT.kind (SCOPE_IN, SCOPE_OUT, PREFERENCE, REQUIREMENT, LOCATION, FINANCE, TEMPORARY, ONE_OFF_DECISION, QUESTION, NOTE) and FACT.topic (COMMUNICATION, REPORTING, DOCUMENTS, AUTOMATION, ADMINS, PAYMENTS, SUPPLIERS, OTHER). A value outside a list drops that item, and the reply says where (items[0].payload.topic).",
  "Each item needs `reason` (one sentence: why it is true and where it was said), and should have `confidence` (the review screen orders by it, lowest first) and `at` (minute in the recording, \"08:13\"). `quote` is optional and short, never from a topics-only source.",
  "SOURCE: `sourceCode` (\"S3\") for a source in the client's register (get_client_file lists it), or `newSource` to register one; it is registered only when at least one item is kept. A recording is found again by firefliesId and an email thread (kind EMAIL) by gmailThreadId, so sending it twice makes no second source. An email thread is a source only when it is this client's; quote only what the client or their supplier wrote.",
  "CHANGES: to change an item already in the file, action SUPERSEDE with `targetId` (the id after the item in get_client_file) and only the fields that change. When someone said otherwise and it is not clear who is right, CONTRADICT with its targetId: nothing is overwritten. Never propose a second item for something in the file: names vary between meetings (\"Washington DOR\" and \"Washington Department of Revenue\"), so look for one first. The reply's `possibleMatches` lists new items that may already exist; resend them as SUPERSEDE or leave them to the reviewer.",
  "NAMES (entityName, routeToNames, systemNames and the like) link to the item in the file with that name on approval; name only what is in the file or in the same batch. Every payload except NARRATIVE, DOMAIN, TASK and DATE may carry externalRefs, ownerName (the person at Ankora who keeps it right) and clientVisible (true only when it is the client's to see; never with sensitivity SENSITIVE or doNotDisclose).",
  "Never include passwords, keys or card numbers: such an item is dropped and a task to change the secret opens. sensitivity SENSITIVE for medical, political or personal information. Leave out small talk, guesses and Ankora's own commercial terms.",
  "WHOSE MEETING: a participant from a client's domain decides. A meeting about several clients: each item its own `client`, with newSource. Not clear and nobody decides: pass the likely `client` and `uncertain` with all candidates; nothing enters a file until a person picks.",
].join(" ");

export function registerClientFileTools(server: McpServer): void {
  server.registerTool(
    "get_client_file",
    {
      title: "Get client file",
      description:
        "Returns a client's file as one Markdown document, in Ankora's standard order: identity and legal entities, scope, people, preferences, requirements, the client's rules (follow them; a proposed rule's interim rule applies until it is approved), systems and access, suppliers, processes (with each one's approved procedure, whether it runs and why not, how well it is documented, and its gaps), finance, communication, dates, temporary information, one-off decisions, open questions, items awaiting confirmation, recent updates, and the source legend. Lines not yet confirmed say so, with what would confirm them; sources appear as [S1 08:13]. Contact details and sensitive items are left out. Read it before working on a client you have not worked on in this conversation, and before drafting anything to the client or their suppliers. Read earlier in the conversation: get_client_changes says what changed since.",
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
    "get_client_brief",
    {
      title: "Get client brief",
      description:
        "A one-page brief of a client's file: who they are, their preferences and requirements, the rules to follow, finance and approval rules, how to communicate with them, what is temporary, open questions and specific working rules in full; people, systems, suppliers and processes by name and id; the next dates; and every \"do not tell\" in one list. Use it for a short question or a short message. For a process, a supplier, a document or anything longer, read get_client_file. Same rules as the file: no contact details, nothing sensitive.",
      inputSchema: z.object({ client: z.string().describe("Client name, as the user said it.") }),
      annotations: TOOL_ANNOTATIONS.get_client_brief,
    },
    async (args: { client: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        return toolText(await clientBrief(actor, client.value.id));
      } catch (err) {
        console.error("[mcp] get_client_brief failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "get_client_changes",
    {
      title: "Get client file changes",
      description:
        "What changed in a client's file since a date: every item added or changed, as it is now and in its section, and what left the file (removed, replaced by a new version, retired). Use it when you read the file earlier in this conversation, or in a run that repeats (pass the time of the last run), instead of reading the whole file again. since: YYYY-MM-DD or an ISO time, at most 90 days back; omitted, the last 7 days.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        since: z.string().optional().describe("YYYY-MM-DD or ISO time. Default: 7 days ago."),
      }),
      annotations: TOOL_ANNOTATIONS.get_client_changes,
    },
    async (args: { client: string; since?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const now = new Date();
        const since = readSince(args.since, now);
        if ("error" in since) return toolText(since.error);
        return toolText(await clientFileChanges(actor, client.value.id, since.since, now));
      } catch (err) {
        console.error("[mcp] get_client_changes failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "propose_knowledge",
    {
      title: "Propose knowledge for a client file",
      description: PROPOSE_KNOWLEDGE_DESCRIPTION,
      // Published with each target's payload fields and closed lists, from
      // the schemas the server validates with (lib/mcp/proposal-schema.ts).
      inputSchema: publishAs(PROPOSE_INPUT, () => publishedInput(PROPOSE_INPUT)),
      annotations: TOOL_ANNOTATIONS.propose_knowledge,
    },
    async (
      args: {
        client: string;
        sourceCode?: string;
        newSource?: { kind: "TRANSCRIPT" | "CLIENT_DOCUMENT" | "TASK" | "PERSON" | "ANKORA_DOCUMENT" | "EMAIL"; title: string; date?: string; participants?: string[]; firefliesId?: string; gmailThreadId?: string; documentId?: string; taskId?: string; topicsOnly?: boolean; clientConversation?: boolean };
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
        // 28.10.2026: a "בלי AI" task or document is not a source. The
        // client is checked by lookupClient; these two arrive as raw ids.
        if (ns?.taskId && (await isTaskAiExcluded(ns.taskId))) return toolText(AI_EXCLUDED_TOOL_MESSAGE);
        if (ns?.documentId && (await isDocumentAiExcluded(ns.documentId))) return toolText(AI_EXCLUDED_TOOL_MESSAGE);
        if (ns?.date && !/^\d{4}-\d{2}-\d{2}$/.test(ns.date)) return toolText("newSource.date must be YYYY-MM-DD.");
        if (ns?.kind === "EMAIL" && !ns.gmailThreadId) return toolText("newSource of kind EMAIL needs `gmailThreadId`, so the same thread is never registered twice.");
        const newSource = ns
          ? {
              kind: ns.kind,
              title: ns.title,
              occurredAt: ns.date ? new Date(`${ns.date}T00:00:00Z`) : null,
              participants: ns.participants,
              externalIds: [ns.firefliesId, ns.gmailThreadId, ns.documentId, ns.taskId].filter((v): v is string => !!v),
              restriction: ns.topicsOnly ? ("TOPICS_ONLY" as const) : ("NONE" as const),
              ...(ns.kind === "ANKORA_DOCUMENT" && ns.clientConversation ? { weight: "PRIMARY" as const } : {}),
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
                ? `${waiting.waiting} items are waiting for a person to say whose meeting this was, on Ankora's approvals screen (/app/approvals, tab "ידע מהחילוץ"). They enter no file, and no register, until then.`
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
        const matched = batches.reduce((n, b) => n + b.possibleMatches.length, 0);
        const next =
          (proposed > 0
            ? `${proposed} proposals are waiting for a person to approve them on Ankora's approvals screen (/app/approvals, tab "ידע מהחילוץ"). Nothing is in the file yet.`
            : "Nothing was proposed.") +
          (matched > 0 ? ` ${matched} of them may be items already in the file under another spelling (possibleMatches): if they are, propose a SUPERSEDE of the existing id instead.` : "");
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
        "The client's processes (P1, P2...), one line each: what it is for, its triggers, owner (and backup, only when one is set), where it stands in the handover, whether it runs (\"רץ\", or the one reason it will not: no owner, no trigger, no approved procedure, or a scheduled process with no date), how well it is documented (the documentation fields, less those marked not relevant), whether it needs review and why, the approved procedure's version, the next date and the last run. Use get_process for the steps. Sensitive processes, and restricted ones the user is not named on, are left out.",
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

  // The procedure as a document (23.10.2026): Claude translates the
  // approved version to English, a manager approves it on the screen, and
  // only then can it be exported in English.
  const TRANSLATION_GUIDE =
    "Translate into clear, formal business English as used in SOC 2 policies: short declarative sentences, present tense, no marketing tone. Keep product, system and company names as they are (Google Workspace, Slack, Nextage). Write people's names in Latin letters as they would sign them, and give each Hebrew name in `names` its English form. Translate every field that has Hebrew; leave a field out only when the Hebrew is empty. Keep the steps in the same order and number. Do not add, drop or soften anything: the English must say exactly what the approved Hebrew says.";

  server.registerTool(
    "get_procedure_for_translation",
    {
      title: "Get a procedure to translate",
      description:
        "The approved version of a client's procedure, in Hebrew, in exactly the shape save_procedure_translation takes back, with the style guide. Use it when the user asks to translate a procedure (or prepare it in English for a client or an auditor). Draft the English, show it to the user, then save it.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        process: z.string().describe('The process code ("P3") or its title.'),
      }),
      annotations: TOOL_ANNOTATIONS.get_procedure_for_translation,
    },
    async (args: { client: string; process: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const process = await resolveProcess(client.value, args.process);
        if (!process.ok) return toolText(process.message);
        const source = await translationSource(actor, process.id);
        return toolJson({ client: client.value.name, ...source, guide: TRANSLATION_GUIDE });
      } catch (err) {
        console.error("[mcp] get_procedure_for_translation failed", err);
        return toolFailure(err);
      }
    }
  );

  const nullableText = z.string().nullable().optional();
  server.registerTool(
    "save_procedure_translation",
    {
      title: "Save a procedure's English translation",
      description:
        "Saves the English translation of a procedure's approved version as a draft; a manager approves it on the procedure's document page, and only an approved translation is exported. Pass the fields get_procedure_for_translation returned under `hebrew`, in English. Saving again replaces the draft. The answer lists what is still missing or still in Hebrew (`gaps`): fill those and save again until it is empty, then tell the user a manager needs to approve it and give the link.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        process: z.string().describe('The process code ("P3") or its title.'),
        version: z.number().int().describe("The approved version number get_procedure_for_translation returned."),
        translation: z
          .object({
            title: z.string(),
            purpose: nullableText,
            scope: nullableText,
            definitions: nullableText,
            triggerText: nullableText,
            slaText: nullableText,
            owner: nullableText,
            backupOwner: nullableText,
            executor: nullableText,
            approver: nullableText,
            approvalText: nullableText,
            externalParty: nullableText,
            systems: z.array(z.object({ name: z.string(), permission: nullableText })).max(MAX_PROCEDURE_SYSTEMS).optional(),
            exceptionPlaybook: nullableText,
            relatedDocs: nullableText,
            steps: z.array(z.object({ title: z.string(), output: nullableText, verification: nullableText })).max(MAX_PROCEDURE_STEPS),
            highlights: nullableText,
            outputs: nullableText,
            changeNotes: z.record(z.string(), z.string()).optional().describe("Version number to its change note, in English."),
            names: z.record(z.string(), z.string()).optional().describe("Each Hebrew name to its English form."),
          })
          .describe("The English, field for field."),
      }),
      annotations: TOOL_ANNOTATIONS.save_procedure_translation,
    },
    async (args: { client: string; process: string; version: number; translation: unknown }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const process = await resolveProcess(client.value, args.process);
        if (!process.ok) return toolText(process.message);
        const saved = await saveProcedureTranslation(actor, process.id, args.version, args.translation);
        return toolJson({
          saved: true,
          version: saved.version,
          gaps: saved.gaps,
          next: saved.gaps.length ? "Fill the gaps and save again." : "Complete. A manager approves it on the document page.",
          link: `${appBaseUrl()}/app/clients/${client.value.id}/processes/${process.id}/document?lang=en`,
        });
      } catch (err) {
        console.error("[mcp] save_procedure_translation failed", err);
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
        // 28.10.2026: nothing of a "בלי AI" client is listed.
        const listed = await listMyRoutines(actor);
        const marked = await aiExcludedClientIds(listed.map((r) => r.clientId));
        const routines = listed.filter((r) => !marked.has(r.clientId));
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

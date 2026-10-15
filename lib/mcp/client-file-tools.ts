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
        "Returns a client's file as one Markdown document, in Ankora's standard order: identity and legal entities, scope, people, preferences, requirements, the client's rules (follow them; a proposed rule's interim rule applies until it is approved), systems and access, suppliers, finance, communication, dates, temporary information, one-off decisions, open questions, items awaiting confirmation, recent updates, and the source legend. Lines not yet confirmed say so, with what would confirm them; sources appear as [S1 08:13]. Contact details and sensitive items are left out. Read it before working on a client you have not worked on in this conversation, and before drafting anything to the client or their suppliers.",
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
        "Every payload may carry knowledgeStatus (CONFIRMED only if the client or their supplier said or showed it explicitly; UNCERTAIN with toResolve otherwise) and sensitivity.",
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

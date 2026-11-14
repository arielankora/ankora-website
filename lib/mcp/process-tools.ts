import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { describeResolveFailure, resolveByName } from "@/lib/mcp/resolve";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { resolveProcess } from "@/lib/mcp/client-file-tools";
import { appBaseUrl } from "@/lib/email-templates";
import { processUrl } from "@/lib/approval-links";
import { prisma } from "@/lib/prisma";
import { canSendToAi } from "@/lib/knowledge";
import { addProcess, setProcessKind, updateProcess } from "@/lib/app-domain/processes";
import { saveProcessRhythm } from "@/lib/app-domain/process-rhythm";
import { resolveLesson } from "@/lib/app-domain/process-lessons";
import { markProcessReviewed } from "@/lib/app-domain/process-review";
import { updateClientContact } from "@/lib/app-domain/client-contacts";
import { readStartInput, type StartInput } from "@/lib/process-rhythm";
import type { User } from "@prisma/client";

// 14.11.2026 (processes redesign, MCP): what a person does to a process on
// its page, for Claude. Every tool here writes what the user said, after
// they said it; approving a procedure, pausing, retiring and deleting stay
// on the screen.

const CLIENT = z.string().describe("Client name, as the user said it.");
const PROCESS = z.string().describe('The process code ("P3") or its title.');

const RULE = z
  .object({
    frequency: z.enum(["BUSINESS_DAILY", "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "ONCE"]),
    weekdays: z.array(z.number().int().min(0).max(6)).optional().describe("WEEKLY: 0 Sunday to 6 Saturday."),
    monthDays: z.array(z.number().int().min(1).max(31)).optional().describe("MONTHLY and QUARTERLY: days of the month; 31 is the last day."),
    quarterMonth: z.number().int().min(1).max(3).optional().describe("QUARTERLY: which month of each quarter."),
    yearDates: z.array(z.object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })).optional().describe("YEARLY: each date."),
    onceDate: z.string().optional().describe("ONCE: YYYY-MM-DD."),
    roll: z.enum(["PREVIOUS_BUSINESS_DAY", "NEXT_BUSINESS_DAY", "NONE"]).optional().describe("Where a date on a weekend or a holiday moves. Not for daily."),
    leadBusinessDays: z.number().int().min(0).max(60).nullable().optional().describe("Open the run this many business days before the date. Leave it out: as the steps need."),
    rangeStart: z.string().nullable().optional().describe("Only from this day, YYYY-MM-DD."),
    rangeEnd: z.string().nullable().optional().describe("Only until this day, YYYY-MM-DD."),
    condition: z.string().nullable().optional().describe("Only if this is true, in Hebrew."),
  })
  .describe("A schedule.");

const START = z.object({
  kind: z.enum(["SCHEDULE", "EVENT", "ON_DEMAND", "CONTINUOUS", "EXTERNAL"]),
  schedule: RULE.nullable().optional().describe("SCHEDULE: the rule. null keeps dates linked before the rhythm editor as they are."),
  description: z.string().optional().describe("EVENT: what happens that starts it, in Hebrew."),
  checkEveryDays: z.number().int().min(1).max(365).nullable().optional().describe("CONTINUOUS: a check every N days."),
  checkText: z.string().nullable().optional().describe("CONTINUOUS: what is checked."),
  where: z.string().optional().describe("EXTERNAL: where it runs outside the app (a scheduled Claude task in the ops account...)."),
  when: z.string().optional().describe("EXTERNAL: when, in words."),
  recipient: z.string().nullable().optional().describe("EXTERNAL: who gets the result."),
});

/// A person at Ankora on the client, by name.
async function staffOf(clientId: string, name: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null, status: "ACTIVE", role: { not: "CLIENT_USER" }, OR: [{ clientAccess: { some: { clientId } } }, { role: "ANKORA_ADMIN" }] },
    select: { id: true, name: true },
  });
  const r = resolveByName(name, users);
  return r.status === "ok" ? { ok: true, id: r.match.id } : { ok: false, message: describeResolveFailure(r, "person at Ankora", users) };
}

/// A contact in the client's file, by name, that Claude may see.
async function contactOf(actor: User, clientId: string, name: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const rows = await prisma.clientContact.findMany({
    where: { clientId, deletedAt: null },
    select: { id: true, role: true, sensitivity: true, audience: true, audienceUserIds: true, person: { select: { name: true } } },
  });
  const contacts = rows.filter((c) => canSendToAi(c, actor.id) && (c.person.name || c.role)).map((c) => ({ id: c.id, name: (c.person.name ?? c.role)! }));
  const r = resolveByName(name, contacts);
  return r.status === "ok" ? { ok: true, id: r.match.id } : { ok: false, message: describeResolveFailure(r, "contact", contacts) };
}

type ProcessFields = {
  title?: string;
  purpose?: string | null;
  owner?: string | null;
  backup?: string | null;
  executor?: string | null;
  sla?: string | null;
  slaBusinessDays?: number | null;
  externalParty?: string | null;
  approvals?: string | null;
  exceptionPlaybook?: string | null;
  rhythmNotes?: string | null;
};

const FIELDS = {
  title: z.string().min(1).max(200).optional().describe("The process's name, in Hebrew."),
  purpose: z.string().max(2000).nullable().optional().describe("What it is for, in one or two sentences."),
  owner: z.string().nullable().optional().describe("Who owns it: a person at Ankora on the client, by name."),
  backup: z.string().nullable().optional().describe("Who stands in for the owner, by name."),
  executor: z
    .string()
    .nullable()
    .optional()
    .describe("Who does it today: a person at Ankora or a contact in the client's file by name, or free words when neither (\"Nextage\")."),
  sla: z.string().max(1000).nullable().optional().describe("How long handling may take, in words."),
  slaBusinessDays: z.number().int().min(0).max(365).nullable().optional().describe("The same, in business days."),
  externalParty: z.string().max(2000).nullable().optional().describe("Who outside the client takes part (an accountant, a bank), in words."),
  approvals: z.string().max(2000).nullable().optional().describe("The approval thresholds, in words. Each step's own approver is set in its procedure."),
  exceptionPlaybook: z.string().max(4000).nullable().optional().describe("What to do when it goes wrong."),
  rhythmNotes: z.string().max(1000).nullable().optional().describe("Notes on when it runs that schedule nothing (\"the file goes to Nextage two business days before\")."),
};

/// The fields as updateProcess takes them: names become ids. A name that
/// matches nobody is said back, never guessed.
async function processInput(actor: User, clientId: string, a: ProcessFields): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  const out: Record<string, unknown> = {};
  if (a.title !== undefined) out.title = a.title;
  if (a.purpose !== undefined) out.purpose = a.purpose;
  if (a.sla !== undefined) out.slaText = a.sla;
  if (a.slaBusinessDays !== undefined) out.slaBusinessDays = a.slaBusinessDays;
  if (a.externalParty !== undefined) out.externalPartyText = a.externalParty;
  if (a.approvals !== undefined) out.approvalText = a.approvals;
  if (a.exceptionPlaybook !== undefined) out.exceptionPlaybook = a.exceptionPlaybook;
  if (a.rhythmNotes !== undefined) out.triggerNotes = a.rhythmNotes;
  for (const [key, field] of [
    ["owner", "ownerId"],
    ["backup", "backupOwnerId"],
  ] as const) {
    const v = a[key];
    if (v === undefined) continue;
    if (v === null || !v.trim()) {
      out[field] = null;
      continue;
    }
    const who = await staffOf(clientId, v);
    if (!who.ok) return { ok: false, message: `${key}: ${who.message}` };
    out[field] = who.id;
  }
  if (a.executor !== undefined) {
    out.executorUserId = null;
    out.executorContactId = null;
    out.executorText = null;
    const v = a.executor?.trim();
    if (v) {
      const staff = await staffOf(clientId, v);
      const contact = staff.ok ? null : await contactOf(actor, clientId, v);
      if (staff.ok) out.executorUserId = staff.id;
      else if (contact?.ok) out.executorContactId = contact.id;
      else out.executorText = v;
    }
  }
  return { ok: true, value: out };
}

export function registerProcessTools(server: McpServer): void {
  server.registerTool(
    "set_process_rhythm",
    {
      title: "Set when a process runs",
      description:
        "Sets a process's rhythm: everything that starts it, each kind once. SCHEDULE with a rule (every business day, every day, weekdays, days of the month with 31 as the last, a month in each quarter, dates in a year, once), and where a date on a weekend or holiday moves; EVENT with what happens; ON_DEMAND; CONTINUOUS with a check every N days; EXTERNAL when it runs outside the app (where, when, who gets the result). It replaces the whole rhythm: send every start the process keeps (get_process `rhythmDetail` shows the current ones). A schedule's dates are created behind the scenes. Answers with the sentence and the next dates. Only after the user agreed to the change.",
      inputSchema: z.object({
        client: CLIENT,
        process: PROCESS,
        starts: z.array(START).min(1).max(5),
        notes: z.string().max(1000).nullable().optional().describe("Notes on the rhythm that schedule nothing. Leave it out to keep the current ones."),
      }),
      annotations: TOOL_ANNOTATIONS.set_process_rhythm,
    },
    async (args: { client: string; process: string; starts: Record<string, unknown>[]; notes?: string | null }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const process = await resolveProcess(client.value, args.process);
        if (!process.ok) return toolText(process.message);
        const starts = args.starts.map(readStartInput);
        if (starts.some((s) => s === null)) return toolText("A start could not be read: a SCHEDULE needs a rule with a frequency (or null to keep linked dates).");
        const updated = await saveProcessRhythm(actor, process.id, starts as StartInput[], args.notes);
        return toolJson({ saved: true, rhythm: updated.triggerText, rhythmNotes: updated.triggerNotes, url: processUrl(appBaseUrl(), client.value.id, process.id) });
      } catch (err) {
        console.error("[mcp] set_process_rhythm failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "create_process",
    {
      title: "Create a process or a work guide",
      description:
        "Creates a new process in a client's file as a draft, or a work guide (kind GUIDE, \"הוראת עבודה\": how to do something, with steps and no rhythm or runs). Use it when the user asks to open one by hand; for what came out of a meeting or a document, propose_knowledge is the way, so a person reviews it. `sources` are codes from the client's source register (get_client_file) that say it; without them it enters as uncertain, with toResolve. Then set its rhythm (set_process_rhythm) and draft its steps (save_procedure_draft). Calling it twice creates two.",
      inputSchema: z.object({
        client: CLIENT,
        kind: z.enum(["PROCESS", "GUIDE"]).optional().describe("PROCESS (the default) or GUIDE."),
        ...FIELDS,
        title: z.string().min(1).max(200).describe("The process's name, in Hebrew."),
        sources: z.array(z.string()).max(10).optional().describe('Source register codes, e.g. ["S3"].'),
        toResolve: z.string().max(500).optional().describe("Without sources: what would confirm it."),
      }),
      annotations: TOOL_ANNOTATIONS.create_process,
    },
    async (args: ProcessFields & { client: string; kind?: "PROCESS" | "GUIDE"; title: string; sources?: string[]; toResolve?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const input = await processInput(actor, client.value.id, args);
        if (!input.ok) return toolText(input.message);
        const sourced = args.sources?.length
          ? { sources: args.sources.map((code) => ({ code: code.trim() })) }
          : { knowledgeStatus: "UNCERTAIN" as const, toResolve: args.toResolve?.trim() || "מקור לתהליך" };
        const row = await addProcess(actor, { ...(input.value as object), ...sourced, clientId: client.value.id, title: args.title });
        if (args.kind === "GUIDE") await setProcessKind(actor, row.id, "GUIDE");
        return toolJson({ created: true, code: row.code, title: row.title, kind: args.kind ?? "PROCESS", url: processUrl(appBaseUrl(), client.value.id, row.id) });
      } catch (err) {
        console.error("[mcp] create_process failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "update_process",
    {
      title: "Edit a process's details",
      description:
        "Edits what the process's page shows under its name and in \"פרטים לעבודה\": name, purpose, owner, backup, who does it today, handling time, external party, approval thresholds in words, the exception playbook, notes on the rhythm; and `kind` to make it a work guide or a process again. Send only what changes. People are by name; a name that matches nobody comes back as a question. Steps change with save_procedure_draft, the rhythm with set_process_rhythm. Only after the user agreed to the change.",
      inputSchema: z.object({
        client: CLIENT,
        process: PROCESS,
        kind: z.enum(["PROCESS", "GUIDE"]).optional().describe("Make it a work guide (GUIDE) or a process (PROCESS)."),
        ...FIELDS,
      }),
      annotations: TOOL_ANNOTATIONS.update_process,
    },
    async (args: ProcessFields & { client: string; process: string; kind?: "PROCESS" | "GUIDE" }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const process = await resolveProcess(client.value, args.process);
        if (!process.ok) return toolText(process.message);
        const input = await processInput(actor, client.value.id, args);
        if (!input.ok) return toolText(input.message);
        const changed = Object.keys(input.value);
        if (!changed.length && !args.kind) return toolText("Nothing to change: send at least one field.");
        if (changed.length) await updateProcess(actor, process.id, input.value);
        if (args.kind) await setProcessKind(actor, process.id, args.kind);
        return toolJson({ saved: true, changed: [...changed, ...(args.kind ? ["kind"] : [])], url: processUrl(appBaseUrl(), client.value.id, process.id) });
      } catch (err) {
        console.error("[mcp] update_process failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "resolve_process_lesson",
    {
      title: "Decide a lesson left on a process",
      description:
        "Decides one open lesson people left when closing a run (get_process `openLessons`, by id): APPLIED with where it went into the procedure (\"גרסה 4, שלב 2\"), or DISMISSED with why not. The process's owner or a manager decides. Only after the user decided.",
      inputSchema: z.object({
        client: CLIENT,
        lessonId: z.string().describe("The lesson's id from get_process openLessons."),
        decision: z.enum(["APPLIED", "DISMISSED"]),
        resolution: z.string().min(1).max(500).describe("Where it went in (APPLIED), or why not (DISMISSED), in Hebrew."),
      }),
      annotations: TOOL_ANNOTATIONS.resolve_process_lesson,
    },
    async (args: { client: string; lessonId: string; decision: "APPLIED" | "DISMISSED"; resolution: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        // The lesson must be the named client's: lookupClient is what keeps
        // a client marked "בלי AI" out.
        const lesson = await prisma.processLesson.findUnique({ where: { id: args.lessonId }, select: { clientId: true } });
        if (!lesson || lesson.clientId !== client.value.id) return toolText(`No open lesson ${args.lessonId} for ${client.value.name}. Read get_process openLessons for the ids.`);
        await resolveLesson(actor, args.lessonId, args.decision, args.resolution);
        return toolJson({ saved: true, decision: args.decision });
      } catch (err) {
        console.error("[mcp] resolve_process_lesson failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "mark_process_reviewed",
    {
      title: "Mark a procedure as reviewed",
      description:
        "Marks a process's approved procedure as reviewed: it no longer needs review (get_process `needsReview`) until its next review date. A manager's call, and only when the procedure passes the client's rules today. Only after the user said it was reviewed.",
      inputSchema: z.object({ client: CLIENT, process: PROCESS }),
      annotations: TOOL_ANNOTATIONS.mark_process_reviewed,
    },
    async (args: { client: string; process: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const process = await resolveProcess(client.value, args.process);
        if (!process.ok) return toolText(process.message);
        await markProcessReviewed(actor, process.id);
        return toolJson({ saved: true, url: processUrl(appBaseUrl(), client.value.id, process.id) });
      } catch (err) {
        console.error("[mcp] mark_process_reviewed failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "set_contact_ended",
    {
      title: "Mark that a contact left",
      description:
        "Records that a contact in a client's file left, or stopped being in their role, on a day (or clears it with endedAt null). Every approved step they approve then shows the process needs a new approver (get_process `approverLeft`). Only after the user said so; never from a guess.",
      inputSchema: z.object({
        client: CLIENT,
        contact: z.string().describe("The contact's name, as in the client's file."),
        endedAt: z.string().nullable().describe("The day they left, YYYY-MM-DD, or null if they did not."),
      }),
      annotations: TOOL_ANNOTATIONS.set_contact_ended,
    },
    async (args: { client: string; contact: string; endedAt: string | null }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const contact = await contactOf(actor, client.value.id, args.contact);
        if (!contact.ok) return toolText(contact.message);
        await updateClientContact(actor, contact.id, { endedAt: args.endedAt });
        return toolJson({ saved: true, contact: args.contact, endedAt: args.endedAt });
      } catch (err) {
        console.error("[mcp] set_contact_ended failed", err);
        return toolFailure(err);
      }
    }
  );
}

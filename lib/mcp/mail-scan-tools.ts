import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/email-templates";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { TASK_ARGS, actorOf, findTask } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { FIELD_NOTES_SENTENCE, withFieldNotes } from "@/lib/mcp/field-notes";
import { EMAIL_WAITS_NOTES, SENT_EMAILS_NOTES } from "@/lib/mcp/tool-field-notes";
import { parseBlockTarget } from "@/lib/mail-scan/rules";
import { parseRemindAt } from "@/lib/mail-scan/wait-rules";
import {
  blockByValue,
  changeMailOwner,
  chooseMailboxKind,
  createMailConnectLink,
  decideMailBlock,
  mailboxFor,
  requestMailBlock,
  revokeMailBlock,
  senderSuggestions,
  setMailExtractionAllowed,
  startScanning,
} from "@/lib/mail-scan/channels";
import { markThreadsExtracted, readThreadAttachment, readThreadForExtraction, threadsToExtract } from "@/lib/mail-scan/extraction";
import { EXTRACT_THREADS_NOTES, READ_THREAD_NOTES } from "@/lib/mcp/tool-field-notes";
import { followEmailReply, myOpenWaits, sendWaitReminder, sentEmails, setReminder, stopFollowing, threadSentTo } from "@/lib/mail-scan/waits";

// "התיבות שלי" through the connector (27.11.2026, Ariel: "כל מה שיש באפליקציה
// בנושא זמינים גם דרך ה-MCP"): everything the two mailbox screens and the
// task screen's email wait do, so nobody has to open the app for it. The
// rules are the domain's (lib/mail-scan/channels.ts and waits.ts); these
// tools only find what the user named.

const MAILBOX = z.string().max(320).optional().describe("The mailbox's address. May be left out when the user has one mailbox.");
const WHEN = z
  .string()
  .max(40)
  .optional()
  .describe("YYYY-MM-DD (09:00 Israel time), YYYY-MM-DDTHH:MM (Israel time) or an ISO time. In the future.");
const BLOCKERS = ["CLIENT", "SUPPLIER", "INTERNAL", "OTHER"] as const;

function badWhen(raw: string | undefined): boolean {
  return Boolean(raw && !parseRemindAt(raw));
}
const BAD_WHEN = "The time must be in the future: YYYY-MM-DD, YYYY-MM-DDTHH:MM (Israel time) or an ISO time.";

export function registerMailScanTools(server: McpServer): void {
  server.registerTool(
    "manage_connected_mailbox",
    {
      title: "Connect and set up a mailbox for scanning",
      description: [
        'Does on "התיבות שלי" what its screens do. connect_link (a new mailbox) and reconnect_link (`mailbox`): a sign-in link to give the user as is; they open it in a browser and sign in on Google\'s or Microsoft\'s own screen, within 30 minutes.',
        "set_kind: whose mailbox it is, `kind` ANKORA or CLIENT with `client`. suggest_senders: the outside senders of the last 30 days, to ask the user which must not be read. do_not_read: an address or a domain (`value`) not to read. start_scan: turns scanning on; only after the user confirmed what not to read.",
        "Managers only: decide_do_not_read (`value`, `approve`), revoke_do_not_read (`value`), set_extraction (`allowed`), change_owner (`person`, the new owner's email). list_connected_mailboxes shows each mailbox and its list.",
      ].join(" "),
      inputSchema: z.object({
        action: z.enum([
          "connect_link",
          "reconnect_link",
          "set_kind",
          "suggest_senders",
          "do_not_read",
          "start_scan",
          "decide_do_not_read",
          "revoke_do_not_read",
          "set_extraction",
          "change_owner",
        ]),
        mailbox: MAILBOX,
        kind: z.enum(["ANKORA", "CLIENT"]).optional(),
        client: z.string().max(200).optional().describe("For set_kind CLIENT: the client's name, as the user said it."),
        value: z.string().max(320).optional().describe("An address (name@example.com) or a domain (example.com)."),
        label: z.string().max(200).optional().describe("For do_not_read: who it is, so a manager knows."),
        approve: z.boolean().optional(),
        allowed: z.boolean().optional(),
        person: z.string().max(320).optional().describe("For change_owner: the new owner's email."),
      }),
      annotations: TOOL_ANNOTATIONS.manage_connected_mailbox,
    },
    async (
      args: {
        action: string;
        mailbox?: string;
        kind?: "ANKORA" | "CLIENT";
        client?: string;
        value?: string;
        label?: string;
        approve?: boolean;
        allowed?: boolean;
        person?: string;
      },
      ctx: ServerContext,
    ) => {
      try {
        const actor = actorOf(ctx);
        const redirectUri = `${appBaseUrl()}/app/whatsapp-poc/mail/connect/callback`;
        switch (args.action) {
          case "connect_link": {
            const { link } = await createMailConnectLink(actor, { redirectUri });
            return toolJson({ link, validMinutes: 30, then: "After signing in, the user chooses whose mailbox it is and what not to read (set_kind, do_not_read), then scanning starts (start_scan)." });
          }
          case "reconnect_link": {
            const channel = await mailboxFor(actor, args.mailbox);
            const { link } = await createMailConnectLink(actor, { redirectUri, channelId: channel.id });
            return toolJson({ mailbox: channel.address, link, validMinutes: 30 });
          }
          case "set_kind": {
            const channel = await mailboxFor(actor, args.mailbox);
            if (args.kind === "CLIENT") {
              if (!args.client) return toolText("Say which client: pass `client`.");
              const client = await lookupClient(actor, args.client);
              if (!client.ok) return toolText(client.message);
              await chooseMailboxKind(actor, channel.id, { kind: "CLIENT", clientId: client.value.id });
              return toolJson({ mailbox: channel.address, kind: "CLIENT", client: client.value.name });
            }
            if (args.kind !== "ANKORA") return toolText("Pass `kind`: ANKORA, or CLIENT with `client`.");
            await chooseMailboxKind(actor, channel.id, { kind: "ANKORA" });
            return toolJson({ mailbox: channel.address, kind: "ANKORA" });
          }
          case "suggest_senders": {
            const channel = await mailboxFor(actor, args.mailbox);
            return toolJson({ mailbox: channel.address, senders: await senderSuggestions(channel) });
          }
          case "do_not_read": {
            const channel = await mailboxFor(actor, args.mailbox);
            const target = args.value ? parseBlockTarget(args.value) : null;
            if (!target) return toolText("`value` must be an email address (name@example.com) or a domain (example.com).");
            const block = await requestMailBlock(actor, { channelId: channel.id, ...target, label: args.label?.trim() || null });
            return toolJson({ mailbox: channel.address, value: block.value, kind: block.kind, status: block.status });
          }
          case "start_scan": {
            const channel = await mailboxFor(actor, args.mailbox);
            await startScanning(actor, channel.id);
            return toolJson({ mailbox: channel.address, scanning: true });
          }
          case "decide_do_not_read":
          case "revoke_do_not_read": {
            const channel = await mailboxFor(actor, args.mailbox);
            if (!args.value) return toolText("Pass `value`, the address or domain on the list.");
            const block = await blockByValue(channel.id, args.value);
            if (args.action === "revoke_do_not_read") {
              await revokeMailBlock(actor, block.id);
              return toolJson({ mailbox: channel.address, value: block.value, status: "REVOKED" });
            }
            if (args.approve === undefined) return toolText("Pass `approve`: true or false.");
            await decideMailBlock(actor, block.id, args.approve);
            return toolJson({ mailbox: channel.address, value: block.value, status: args.approve ? "APPROVED" : "REJECTED" });
          }
          case "set_extraction": {
            const channel = await mailboxFor(actor, args.mailbox);
            if (args.allowed === undefined) return toolText("Pass `allowed`: true or false.");
            await setMailExtractionAllowed(actor, channel.id, args.allowed);
            return toolJson({ mailbox: channel.address, extractionAllowed: args.allowed });
          }
          case "change_owner": {
            const channel = await mailboxFor(actor, args.mailbox);
            const email = args.person?.trim().toLowerCase();
            const owner = email ? await prisma.user.findFirst({ where: { email, deletedAt: null }, select: { id: true, name: true } }) : null;
            if (!owner) return toolText("No team member with that email. list_team_members gives their emails.");
            await changeMailOwner(actor, channel.id, owner.id);
            return toolJson({ mailbox: channel.address, owner: owner.name });
          }
          default:
            return toolText("Unknown action.");
        }
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "list_sent_emails",
    {
      title: "List the emails you sent from your scanned mailboxes",
      description: [
        'The emails the user sent in the last 14 days from their mailboxes connected on "התיבות שלי", newest first. Call it before follow_email_reply when it is not clear which email the user means. `to` narrows the list to one address. Read-only.',
        FIELD_NOTES_SENTENCE,
      ].join(" "),
      inputSchema: z.object({ to: z.string().max(320).optional().describe("Only emails to this address.") }),
      annotations: TOOL_ANNOTATIONS.list_sent_emails,
    },
    async (args: { to?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const to = args.to?.trim().toLowerCase();
        const rows = (await sentEmails(actor)).filter((r) => !to || r.sentTo.includes(to));
        const clients = await prisma.client.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.clientIds))] }, aiExcluded: false }, select: { id: true, name: true } });
        const name = new Map(clients.map((c) => [c.id, c.name]));
        return toolJson(
          withFieldNotes(
            { emails: rows.map((r) => ({ to: r.sentTo, sentAt: r.sentAt.toISOString(), mailbox: r.mailbox, clients: r.clientIds.map((id) => name.get(id)).filter(Boolean) })) },
            SENT_EMAILS_NOTES,
          ),
        );
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "follow_email_reply",
    {
      title: "Make a task wait for a reply to an email",
      description: [
        "Makes a task, or a step (its title in `task`), wait for a reply to an email the user sent: it is marked as waiting on `waitingOn`, and when someone other than the sender writes in that thread, Ankora lifts the wait and tells the user. With no reply by `remindAt` (default two working days), the user is reminded.",
        "Pass `to`, an address the email went to: the newest email the user sent to it in the last 14 days is followed (list_sent_emails shows them). After an email in a task's work that needs an answer, offer to follow it; if the user asked you to follow such emails, do it without asking.",
      ].join(" "),
      inputSchema: z.object({
        ...TASK_ARGS,
        to: z.string().max(320).describe("An address the email was sent to."),
        waitingOn: z.enum(BLOCKERS).describe("Whom the task waits for."),
        reason: z.string().max(500).optional().describe("Why it waits, in one sentence."),
        remindAt: WHEN,
        noReminder: z.boolean().optional().describe("true for no reminder at all."),
      }),
      annotations: TOOL_ANNOTATIONS.follow_email_reply,
    },
    async (
      args: { task?: string; taskId?: string; client?: string; to: string; waitingOn: (typeof BLOCKERS)[number]; reason?: string; remindAt?: string; noReminder?: boolean },
      ctx: ServerContext,
    ) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);
        if (badWhen(args.remindAt)) return toolText(BAD_WHEN);
        const sent = await threadSentTo(actor, args.to);
        if (!sent) return toolText(`No email to ${args.to} in the last 14 days from the user's mailboxes connected for scanning. list_sent_emails shows what can be followed; a mailbox is connected with manage_connected_mailbox.`);
        const wait = await followEmailReply(actor, {
          taskId: found.value.id,
          threadId: sent.threadId,
          waitingOn: args.waitingOn,
          reason: args.reason ?? null,
          remindAt: args.noReminder ? null : args.remindAt ? parseRemindAt(args.remindAt) : undefined,
          via: "CLAUDE",
        });
        return toolJson({ task: found.value.name, following: { to: wait.sentTo, sentAt: wait.sentAt.toISOString(), remindAt: wait.remindAt?.toISOString() ?? null }, waitingOn: args.waitingOn });
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "manage_email_wait",
    {
      title: "Change or end a task's wait for an email reply",
      description: [
        "On a task (or step) that waits for an email reply (get_task shows it in `waitingOnEmail`): stop_following (it keeps waiting, the email is no longer followed), not_waiting (stops following and lifts the wait), postpone (a new reminder at `remindAt`), send_reminder (sends `text` as a reply in the same thread, from the same mailbox, to whom the email went; only on the user's explicit request after they saw the text; the next reminder is `remindAt`, or two working days).",
      ].join(" "),
      inputSchema: z.object({
        ...TASK_ARGS,
        action: z.enum(["stop_following", "not_waiting", "postpone", "send_reminder"]),
        remindAt: WHEN,
        text: z.string().max(5000).optional().describe("For send_reminder: the reminder's text."),
      }),
      annotations: TOOL_ANNOTATIONS.manage_email_wait,
    },
    async (args: { task?: string; taskId?: string; client?: string; action: string; remindAt?: string; text?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);
        if (badWhen(args.remindAt)) return toolText(BAD_WHEN);
        const at = args.remindAt ? parseRemindAt(args.remindAt) : undefined;
        switch (args.action) {
          case "stop_following":
          case "not_waiting":
            await stopFollowing(actor, found.value.id, { unblock: args.action === "not_waiting" });
            return toolJson({ task: found.value.name, done: args.action });
          case "postpone":
            if (!at) return toolText("Pass `remindAt` for postpone.");
            await setReminder(actor, found.value.id, at);
            return toolJson({ task: found.value.name, remindAt: at.toISOString() });
          case "send_reminder":
            if (!args.text?.trim()) return toolText("Pass `text`, the reminder the user approved.");
            await sendWaitReminder(actor, found.value.id, { text: args.text, nextRemindAt: at });
            return toolJson({ task: found.value.name, sent: true });
          default:
            return toolText("Unknown action.");
        }
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "list_email_waits",
    {
      title: "List the email replies you are waiting for",
      description: ["The emails the user follows on tasks and is still waiting for a reply to, those past their reminder first. Read-only.", FIELD_NOTES_SENTENCE].join(" "),
      inputSchema: z.object({}),
      annotations: TOOL_ANNOTATIONS.list_email_waits,
    },
    async (_args: Record<string, never>, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        return toolJson(withFieldNotes({ waits: await myOpenWaits(actor) }, EMAIL_WAITS_NOTES));
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  // Stage 3 (27.11.2026): knowledge extraction from scanned mailboxes.
  server.registerTool(
    "list_email_threads_to_extract",
    {
      title: "List email threads with something new to extract",
      description: [
        "The threads with clients in scanned mailboxes that have emails the knowledge extraction has not read yet, oldest first. For the extraction account (every mailbox whose extraction is allowed) or a mailbox's owner (their own). `client` narrows to one client. Read-only.",
        FIELD_NOTES_SENTENCE,
      ].join(" "),
      inputSchema: z.object({ client: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional() }),
      annotations: TOOL_ANNOTATIONS.list_email_threads_to_extract,
    },
    async (args: { client?: string; limit?: number }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        let clientId: string | undefined;
        if (args.client) {
          const client = await lookupClient(actor, args.client);
          if (!client.ok) return toolText(client.message);
          clientId = client.value.id;
        }
        return toolJson(withFieldNotes({ threads: await threadsToExtract(actor, { clientId, limit: args.limit }) }, EXTRACT_THREADS_NOTES));
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "read_email_thread",
    {
      title: "Read a thread's new emails for extraction",
      description: [
        "The emails of one thread from list_email_threads_to_extract that the extraction has not read, oldest first, with their text and attachments' ids. `all` adds the emails already read, for context. Read-only.",
        FIELD_NOTES_SENTENCE,
      ].join(" "),
      inputSchema: z.object({ thread: z.string().max(100), all: z.boolean().optional() }),
      annotations: TOOL_ANNOTATIONS.read_email_thread,
    },
    async (args: { thread: string; all?: boolean }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        return toolJson(withFieldNotes(await readThreadForExtraction(actor, args.thread, { all: args.all }), READ_THREAD_NOTES));
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "read_email_thread_attachment",
    {
      title: "Read an attachment in a thread for extraction",
      description: "The text of a file attached to an email in a thread from read_email_thread: PDF, Word, Excel, PowerPoint or text. Images and scans are not read. Read-only.",
      inputSchema: z.object({ thread: z.string().max(100), emailId: z.string().max(500), attachmentId: z.string().max(500) }),
      annotations: TOOL_ANNOTATIONS.read_email_thread_attachment,
    },
    async (args: { thread: string; emailId: string; attachmentId: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        return toolJson(await readThreadAttachment(actor, args));
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "mark_email_threads_extracted",
    {
      title: "Mark email threads as read by the extraction",
      description:
        "Marks threads read up to `through` (`newestAt` from read_email_thread), so the next run starts after it. Call it for a thread that gave nothing to propose; propose_knowledge with newSource.mailThread marks its thread itself.",
      inputSchema: z.object({
        threads: z
          .array(z.object({ thread: z.string().max(100), through: z.string().max(40) }))
          .min(1)
          .max(100),
      }),
      annotations: TOOL_ANNOTATIONS.mark_email_threads_extracted,
    },
    async (args: { threads: Array<{ thread: string; through: string }> }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        return toolJson({ marked: (await markThreadsExtracted(actor, args.threads)).length });
      } catch (err) {
        return toolFailure(err);
      }
    },
  );
}

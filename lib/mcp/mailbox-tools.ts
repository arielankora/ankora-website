import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { mailboxSetup, mailboxStatus, readAttachment, readEmail, searchEmails, type SearchInput } from "@/lib/client-mailbox/mailbox";

// 26.11.2026 (Ariel and Hadas): a client's own mailbox, connected through
// Unipile on the client's connections screen, read through the connector by
// everyone who sees the client. The rules are in lib/client-mailbox/mailbox.ts.
// This stage reads; drafts, sending, organising and the calendar come next.

const MAILBOX = z
  .string()
  .max(320)
  .optional()
  .describe("The mailbox address, only when the client has more than one connected. get_client_mailbox lists them.");

const CLIENT = z.string().max(200).describe("Client name, as the user said it.");

export function registerMailboxTools(server: McpServer): void {
  server.registerTool(
    "get_client_mailbox",
    {
      title: "Get a client's connected mailbox",
      description: [
        "The client's own mailboxes connected to Ankora (through Unipile), whether each is working, what it can do, and the addresses it can send from.",
        "Call it before working in a client's mailbox, or when another mailbox tool says the connection dropped. An empty list means none is connected: the account manager connects one on the client's connections screen in Ankora. Read-only.",
      ].join(" "),
      inputSchema: z.object({ client: CLIENT }),
      annotations: TOOL_ANNOTATIONS.get_client_mailbox,
    },
    async (args: { client: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        return toolJson({ client: client.value.name, mailboxes: await mailboxStatus(actor, client.value.id) });
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "search_client_emails",
    {
      title: "Search a client's mailbox",
      description: [
        "Searches the client's own connected mailbox, newest first: free text in subject and body, sender, recipient, any participant, dates, unread, starred, with attachments, inside a folder or label, or outside some folders. With no filter it lists the latest emails.",
        "Each email comes with its id, thread id and its attachments' ids. Read one with get_client_email, a file with read_client_email_attachment. Folder ids come from list_client_mail_folders.",
        "`after` and `before` take YYYY-MM-DD (Israel time) or an ISO time. Pass `cursor` from the previous answer for the next page. Text search is the provider's own and may be approximate. Read-only.",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        text: z.string().max(500).optional().describe("Words to find in the subject or body."),
        from: z.string().max(320).optional().describe("Sender address."),
        to: z.string().max(320).optional().describe("Recipient address."),
        participant: z.string().max(1000).optional().describe("One or more addresses, comma separated, in any of from, to, cc or bcc."),
        hasAttachment: z.boolean().optional(),
        unread: z.boolean().optional(),
        starred: z.boolean().optional(),
        after: z.string().max(40).optional().describe("From this day or time on."),
        before: z.string().max(40).optional().describe("Up to this day or time."),
        folderId: z.string().max(200).optional().describe("Only this folder or label (id from list_client_mail_folders)."),
        excludeFolderIds: z.array(z.string().max(200)).max(20).optional().describe("Leave out these folders or labels."),
        outlookCategory: z.string().max(200).optional().describe("Outlook mailboxes only: only emails in this category."),
        limit: z.number().int().min(1).max(100).optional().describe("How many emails, up to 100. Default 25."),
        cursor: z.string().max(2000).optional(),
      }),
      annotations: TOOL_ANNOTATIONS.search_client_emails,
    },
    async (args: SearchInput & { client: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const { client: _name, ...input } = args;
        return toolJson({ client: client.value.name, ...(await searchEmails(actor, client.value.id, input)) });
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "get_client_email",
    {
      title: "Read an email or a thread in a client's mailbox",
      description: [
        "Reads one email, or a whole thread oldest first, from the client's connected mailbox: who, when, the text, and the attachments with their ids. Pass `emailId` or `threadId` from search_client_emails.",
        "A long thread is cut so one read stays reasonable; read a single email by its id for its full text. Read-only.",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        emailId: z.string().max(500).optional(),
        threadId: z.string().max(500).optional(),
      }),
      annotations: TOOL_ANNOTATIONS.get_client_email,
    },
    async (args: { client: string; mailbox?: string; emailId?: string; threadId?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        return toolJson({ client: client.value.name, ...(await readEmail(actor, client.value.id, args)) });
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "read_client_email_attachment",
    {
      title: "Read an attachment in a client's mailbox",
      description: [
        "The text of a file attached to an email in the client's connected mailbox: PDF, Word, Excel, PowerPoint or a text file (a CV, an invoice, a form). Pass the email's id and the attachment's id from search_client_emails or get_client_email.",
        "Images and scanned PDFs have no text to return; the answer says so. Files over 15MB are not read. Read-only.",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        emailId: z.string().max(500),
        attachmentId: z.string().max(500),
      }),
      annotations: TOOL_ANNOTATIONS.read_client_email_attachment,
    },
    async (args: { client: string; mailbox?: string; emailId: string; attachmentId: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        return toolJson({ client: client.value.name, ...(await readAttachment(actor, client.value.id, args)) });
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "list_client_mail_folders",
    {
      title: "List a client mailbox's folders, labels, contacts and categories",
      description: [
        "The folders (in Gmail, the labels) of the client's connected mailbox with their ids and unread counts, to search inside one with search_client_emails.",
        "`include` adds the mailbox's contacts (paged with `contactsCursor`) and, for Outlook, its categories. Read-only.",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        include: z.array(z.enum(["folders", "contacts", "categories"])).max(3).optional().describe('What to list. Default ["folders"].'),
        contactsCursor: z.string().max(2000).optional(),
      }),
      annotations: TOOL_ANNOTATIONS.list_client_mail_folders,
    },
    async (args: { client: string; mailbox?: string; include?: ("folders" | "contacts" | "categories")[]; contactsCursor?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        return toolJson({ client: client.value.name, ...(await mailboxSetup(actor, client.value.id, args)) });
      } catch (err) {
        return toolFailure(err);
      }
    },
  );
}

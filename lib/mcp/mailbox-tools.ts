import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { appBaseUrl } from "@/lib/email-templates";
import { lookupClient } from "@/lib/mcp/lookup";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { mailboxSetup, mailboxStatus, readAttachment, readEmail, searchEmails, type SearchInput } from "@/lib/client-mailbox/mailbox";
import { listClientDrafts, manageClientMailFolders, organizeClientEmail, saveClientDraft, sendClientEmail, type Compose, type OrganizeAction } from "@/lib/client-mailbox/write";
import { mailboxStatusForAi } from "@/lib/mail-scan/channels";
import { withFieldNotes, FIELD_NOTES_SENTENCE } from "@/lib/mcp/field-notes";
import { CONNECTED_MAILBOXES_NOTES } from "@/lib/mcp/tool-field-notes";
import { listClientCalendar, manageClientCalendars, respondClientEvent, saveClientEvent, type EventInput } from "@/lib/client-mailbox/calendar";

// 26.11.2026 (Ariel and Hadas): a client's own mailbox, connected through
// Unipile on the client's connections screen, read through the connector by
// everyone who sees the client. The rules are in lib/client-mailbox/mailbox.ts.
// Stage 2 (26.11.2026): drafts, sending (only on the user's explicit
// request), forwarding, organising, folders and the calendar
// (lib/client-mailbox/write.ts and calendar.ts).

const MAILBOX = z
  .string()
  .max(320)
  .optional()
  .describe("The mailbox address, only when the client has more than one connected. get_client_mailbox lists them.");

const CLIENT = z.string().max(200).describe("Client name, as the user said it.");

export function registerMailboxTools(server: McpServer): void {
  // "התיבות שלי" (27.11.2026): the mailboxes employees connected for
  // scanning, and how each is doing. Never an email: what was recorded is
  // only counted.
  server.registerTool(
    "list_connected_mailboxes",
    {
      title: "List the mailboxes connected for scanning",
      description: [
        "The mailboxes employees connected on \"התיבות שלי\" so Ankora recognises their emails with clients: your own, or every one for a manager. Call it when asked whether someone's mailbox is connected, why a reply was not noticed, or what still needs setting up.",
        "Takes nothing. To connect, reconnect or change one, the user goes to the link in `connectUrl`. Read-only.",
        FIELD_NOTES_SENTENCE,
      ].join(" "),
      inputSchema: z.object({}),
      annotations: TOOL_ANNOTATIONS.list_connected_mailboxes,
    },
    async (_args: Record<string, never>, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const mailboxes = await mailboxStatusForAi(actor);
        return toolJson(withFieldNotes({ mailboxes, connectUrl: `${appBaseUrl()}/app/whatsapp-poc/mail/connect` }, CONNECTED_MAILBOXES_NOTES));
      } catch (err) {
        return toolFailure(err);
      }
    },
  );

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

  const COMPOSE = {
    to: z.array(z.string().max(320)).max(50).optional().describe('Recipients, "name <address>" or the address. A reply goes to the original sender when left empty.'),
    cc: z.array(z.string().max(320)).max(50).optional(),
    bcc: z.array(z.string().max(320)).max(50).optional(),
    subject: z.string().max(500).optional().describe('Defaults to "Re:" or "Fwd:" and the original subject for a reply or a forward.'),
    text: z.string().max(50_000).optional().describe("The message, plain text. Required, except that a forward may carry only the original."),
    from: z.string().max(320).optional().describe("Send-as address, one of get_client_mailbox's sendersAvailable."),
    replyToEmailId: z.string().max(500).optional().describe("Answer this email, inside its thread."),
    replyAll: z.boolean().optional().describe("With replyToEmailId: also everyone else on the original."),
    forwardEmailId: z.string().max(500).optional().describe("Forward this email with its attachments."),
    dropAttachmentIds: z.array(z.string().max(500)).max(50).optional().describe("With forwardEmailId: attachment ids to leave out."),
  };

  async function run<A extends { client: string }>(args: A, ctx: ServerContext, fn: (actor: ReturnType<typeof actorOf>, clientId: string, input: Omit<A, "client">) => Promise<object>) {
    try {
      const actor = actorOf(ctx);
      const client = await lookupClient(actor, args.client);
      if (!client.ok) return toolText(client.message);
      const { client: _name, ...input } = args;
      return toolJson({ client: client.value.name, ...(await fn(actor, client.value.id, input)) });
    } catch (err) {
      return toolFailure(err);
    }
  }

  server.registerTool(
    "list_client_email_drafts",
    {
      title: "List or read the drafts in a client's mailbox",
      description: "The drafts in the client's connected mailbox, newest first, or one draft in full by `draftId`. `participant` narrows to drafts with that address. Read-only.",
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        draftId: z.string().max(500).optional(),
        participant: z.string().max(1000).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().max(2000).optional(),
      }),
      annotations: TOOL_ANNOTATIONS.list_client_email_drafts,
    },
    async (args: { client: string; mailbox?: string; draftId?: string; participant?: string; limit?: number; cursor?: string }, ctx: ServerContext) =>
      run(args, ctx, listClientDrafts),
  );

  server.registerTool(
    "save_client_email_draft",
    {
      title: "Save a draft in a client's mailbox",
      description: [
        "Writes a new email, a reply or a forward as a draft in the client's own Drafts, or updates a draft (`draftId`), or deletes one (`draftId` with `delete`). This is the default way to write from a client's mailbox: show the user the draft, and send only if they ask to.",
        "A forward carries the original's attachments and quotes it under your text. Before writing to or about the client, read the client file (get_client_brief).",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        draftId: z.string().max(500).optional().describe("Update or delete this draft."),
        delete: z.boolean().optional(),
        ...COMPOSE,
      }),
      annotations: TOOL_ANNOTATIONS.save_client_email_draft,
    },
    async (args: Compose & { client: string; draftId?: string; delete?: boolean }, ctx: ServerContext) => run(args, ctx, saveClientDraft),
  );

  server.registerTool(
    "send_client_email",
    {
      title: "Send an email from a client's mailbox",
      description: [
        "Sends from the client's own mailbox: a new email, a reply in its thread, a forward with the original's attachments, or an existing draft (`draftId`). It goes out at once, in the client's name, and cannot be taken back.",
        "Call it only when the user asked in so many words to send, and set `userAskedToSend` to true; otherwise save a draft with save_client_email_draft and show it. Before writing to or about the client, read the client file (get_client_brief).",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        userAskedToSend: z.boolean().describe("True only when the user explicitly asked to send this email now."),
        draftId: z.string().max(500).optional().describe("Send this draft as it is."),
        ...COMPOSE,
      }),
      annotations: TOOL_ANNOTATIONS.send_client_email,
    },
    async (args: Compose & { client: string; draftId?: string; userAskedToSend?: boolean }, ctx: ServerContext) => run(args, ctx, sendClientEmail),
  );

  server.registerTool(
    "organize_client_email",
    {
      title: "Organise emails in a client's mailbox",
      description: [
        "Changes up to 50 emails in the client's connected mailbox: mark read or unread, set, add or remove folders (in Gmail, labels; an empty set archives), set Outlook categories, or move to the trash.",
        "Folder ids come from list_client_mail_folders. Trashing can be undone only from the mailbox itself.",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        emailIds: z.array(z.string().max(500)).min(1).max(50),
        action: z.enum(["mark_read", "mark_unread", "set_folders", "add_folders", "remove_folders", "set_categories", "trash"]),
        folderIds: z.array(z.string().max(200)).max(50).optional(),
        categories: z.array(z.string().max(200)).max(50).optional().describe("Outlook only, for set_categories."),
      }),
      annotations: TOOL_ANNOTATIONS.organize_client_email,
    },
    async (args: { client: string; mailbox?: string; emailIds: string[]; action: OrganizeAction; folderIds?: string[]; categories?: string[] }, ctx: ServerContext) =>
      run(args, ctx, organizeClientEmail),
  );

  server.registerTool(
    "manage_client_mail_folders",
    {
      title: "Create, rename or delete folders in a client's mailbox",
      description: [
        "Creates, updates or deletes a folder (in Gmail, a label) in the client's connected mailbox, or creates or deletes an Outlook category. Gmail labels take text and background colours; Outlook folders take a parent folder; Outlook categories a colour (preset0 to preset24).",
        "Deleting a folder or a category cannot be undone from here.",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        action: z.enum(["create_folder", "update_folder", "delete_folder", "create_category", "delete_category"]),
        folderId: z.string().max(200).optional(),
        name: z.string().max(200).optional(),
        parentId: z.string().max(200).optional(),
        textColor: z.string().max(20).optional(),
        backgroundColor: z.string().max(20).optional(),
        color: z.string().max(20).optional(),
      }),
      annotations: TOOL_ANNOTATIONS.manage_client_mail_folders,
    },
    async (
      args: {
        client: string;
        mailbox?: string;
        action: "create_folder" | "update_folder" | "delete_folder" | "create_category" | "delete_category";
        folderId?: string;
        name?: string;
        parentId?: string;
        textColor?: string;
        backgroundColor?: string;
        color?: string;
      },
      ctx: ServerContext,
    ) => run(args, ctx, manageClientMailFolders),
  );

  server.registerTool(
    "list_client_calendar_events",
    {
      title: "Read a client's calendar",
      description: [
        "The calendar of the client's connected Google or Microsoft account: events in a range (`from`, `to`, YYYY-MM-DD or a time, Israel time), filtered by title text, attendee, location, busy time or cancelled; one event in full by `eventId`; or the list of calendars with `calendarsOnly`.",
        "Without `calendarId` it reads the account's main calendar. Recurring events come as their occurrences. Read-only.",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        calendarsOnly: z.boolean().optional(),
        calendarId: z.string().max(500).optional(),
        eventId: z.string().max(500).optional(),
        from: z.string().max(40).optional(),
        to: z.string().max(40).optional(),
        text: z.string().max(300).optional().describe("Words in the event's title."),
        attendee: z.string().max(1000).optional().describe("Addresses, comma separated."),
        location: z.string().max(300).optional(),
        busyOnly: z.boolean().optional(),
        includeCancelled: z.boolean().optional(),
        expandRecurring: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().max(2000).optional(),
      }),
      annotations: TOOL_ANNOTATIONS.list_client_calendar_events,
    },
    async (args: Parameters<typeof listClientCalendar>[2] & { client: string }, ctx: ServerContext) => run(args, ctx, listClientCalendar),
  );

  server.registerTool(
    "save_client_calendar_event",
    {
      title: "Create or change an event in a client's calendar",
      description: [
        "Creates an event in the client's calendar, or changes one (`eventId`): title, description, location, start and end, attendees, recurrence (RFC 5545 RRULE lines), a Google Meet, Teams or Zoom call, busy or free, private.",
        "`start` and `end` are YYYY-MM-DD for an all-day event, or YYYY-MM-DDTHH:MM in Israel time unless `timezone` or an offset says otherwise. Guests get no invitation unless `notifyGuests` says so: an invitation is a message in the client's name, so set it only when the user asked to invite them.",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        calendarId: z.string().max(500).optional(),
        eventId: z.string().max(500).optional(),
        title: z.string().max(500).optional(),
        description: z.string().max(20_000).optional(),
        location: z.string().max(500).optional(),
        start: z.string().max(40).optional(),
        end: z.string().max(40).optional(),
        timezone: z.string().max(60).optional().describe("IANA zone, e.g. Europe/London. Default Asia/Jerusalem."),
        attendees: z.array(z.string().max(320)).max(100).optional(),
        optionalAttendees: z.array(z.string().max(320)).max(100).optional(),
        recurrence: z.array(z.string().max(500)).max(10).optional(),
        videoCall: z.enum(["google_meet", "teams", "zoom"]).optional(),
        videoCallUrl: z.string().max(1000).optional().describe("An existing call link to attach instead of creating one."),
        busy: z.boolean().optional(),
        private: z.boolean().optional(),
        hideAttendees: z.boolean().optional(),
        notifyGuests: z.enum(["all", "external_only", "none"]).optional().describe("Google only. Default none."),
      }),
      annotations: TOOL_ANNOTATIONS.save_client_calendar_event,
    },
    async (args: EventInput & { client: string }, ctx: ServerContext) => run(args, ctx, saveClientEvent),
  );

  server.registerTool(
    "respond_client_calendar_event",
    {
      title: "Answer, cancel, restore or delete an event in a client's calendar",
      description: [
        "On an event in the client's calendar: accept, maybe or decline an invitation (with an optional comment to the organizer), cancel an event the client organises (its attendees are told), restore a cancelled one, or delete it from the client's calendar.",
        "Cancelling and deleting cannot be undone from here except by restore, where the provider keeps the event.",
      ].join(" "),
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        calendarId: z.string().max(500).optional(),
        eventId: z.string().max(500),
        action: z.enum(["accept", "maybe", "decline", "cancel", "restore", "delete"]),
        comment: z.string().max(2000).optional(),
      }),
      annotations: TOOL_ANNOTATIONS.respond_client_calendar_event,
    },
    async (
      args: { client: string; mailbox?: string; calendarId?: string; eventId: string; action: "accept" | "maybe" | "decline" | "cancel" | "restore" | "delete"; comment?: string },
      ctx: ServerContext,
    ) => run(args, ctx, respondClientEvent),
  );

  server.registerTool(
    "manage_client_calendars",
    {
      title: "Create, change or delete a calendar in a client's account",
      description: "Creates a calendar in the client's connected account, renames or describes one, or deletes one (`calendarId` from list_client_calendar_events with calendarsOnly). Deleting a calendar deletes its events.",
      inputSchema: z.object({
        client: CLIENT,
        mailbox: MAILBOX,
        action: z.enum(["create", "update", "delete"]),
        calendarId: z.string().max(500).optional(),
        name: z.string().max(200).optional(),
        description: z.string().max(2000).optional(),
        timezone: z.string().max(60).optional(),
        color: z.string().max(20).optional(),
      }),
      annotations: TOOL_ANNOTATIONS.manage_client_calendars,
    },
    async (
      args: { client: string; mailbox?: string; action: "create" | "update" | "delete"; calendarId?: string; name?: string; description?: string; timezone?: string; color?: string },
      ctx: ServerContext,
    ) => run(args, ctx, manageClientCalendars),
  );
}

import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { dayStartInZone } from "@/lib/timezone";
import { listClientComms, readClientCall, readClientConversation, type CommsDenied } from "@/lib/comms/client-comms";

// 14.11.2026: a client's WhatsApp conversations and recorded calls, read
// through the connector (lib/comms/client-comms.ts holds the rules). Read
// only. The base for extracting knowledge into the client file.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MESSAGES = 300;

const israel = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/// "2026-11-14 09:05", Israel time.
export function israelTime(d: Date | null): string | null {
  if (!d) return null;
  const p = Object.fromEntries(israel.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const TIMES = "Times are Israel local time, YYYY-MM-DD HH:MM.";

export function deniedText(d: CommsDenied): string {
  return d.denied === "no_access"
    ? "You have no access to the communications screen, so none to its conversations or calls. A manager gives it on your user page in Ankora."
    : "No such conversation or call for this client, or it is not one you may see.";
}

function parseDay(value: string | undefined, name: string): Date | null | string {
  if (!value) return null;
  if (!DATE.test(value)) return `${name} must be YYYY-MM-DD.`;
  const d = dayStartInZone(value);
  return d ?? `${name} is not a valid date.`;
}

export function registerCommsTools(server: McpServer): void {
  server.registerTool(
    "list_client_communications",
    {
      title: "List a client's WhatsApp conversations and recorded calls",
      description: [
        "What Ankora keeps of its communications with one client: the WhatsApp conversations with the client's people (by the numbers in the client file) and with WhatsApp groups assigned to the client, and the recorded phone calls on Ankora's lines with those numbers. Each conversation comes with how many messages it has and when; each call with its direction, length and whether its transcript is ready.",
        "`since` (YYYY-MM-DD, Israel time) counts only what happened from that day on. Read a conversation or a call with get_client_communication, by its `id`.",
        "Only what the user may see on the communications screen is listed: a number they are kept out of stays out, as do messages and calls waiting for a manager's block decision, and any number that also belongs to a client marked \"בלי AI\". `hidden` counts what was left out for the user. Read-only.",
      ].join(" "),
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        since: z.string().optional().describe("YYYY-MM-DD. Only messages and calls from this day on, Israel time."),
      }),
      annotations: TOOL_ANNOTATIONS.list_client_communications,
    },
    async (args: { client: string; since?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const since = parseDay(args.since, "since");
        if (typeof since === "string") return toolText(since);
        const out = await listClientComms(actor, client.value.id, since);
        if ("denied" in out) return toolText(deniedText(out));
        return toolJson({
          client: out.client,
          times: TIMES,
          conversations: out.conversations.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            group: c.isGroup,
            onAnkoraNumberOf: c.ourNumberOwner,
            messages: c.messages,
            first: israelTime(c.firstAt),
            last: israelTime(c.lastAt),
          })),
          calls: out.calls.map((c) => ({
            id: c.id,
            at: israelTime(c.at),
            direction: c.direction === "IN" ? "incoming" : c.direction === "OUT" ? "outgoing" : "unknown",
            phone: c.phone,
            minutes: c.durationSec == null ? null : Math.round((c.durationSec / 60) * 10) / 10,
            transcript: c.transcript === "DONE" ? "ready" : c.transcript === "SKIPPED" ? "not made (בלי AI)" : c.transcript === "NONE" ? "none" : c.transcript.toLowerCase(),
          })),
          hidden: out.hidden,
        });
      } catch (err) {
        console.error("[mcp] list_client_communications failed", err);
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "get_client_communication",
    {
      title: "Read a client's WhatsApp conversation or recorded call",
      description: [
        "One item from list_client_communications, by its `id`: a WhatsApp conversation's messages, or a recorded call's transcript.",
        "A conversation comes oldest first: the latest `limit` messages (default 100, at most 300) in the window `since`..`before` (YYYY-MM-DD, Israel time; `before` is exclusive). `hasEarlier` says there are older ones: ask again with `before` set to the first message's day. Messages from Ankora's side say `fromAnkora`; a voice message carries its transcript when one was made; a message deleted in WhatsApp is kept and marked `deleted`. A reply carries `replyTo`: who wrote the message it answers (`from`: \"Ankora\", a name, or \"unknown\" when WhatsApp hid it) and the quoted text.",
        "A call returns its transcript once it is ready (the nightly run makes them). The same visibility as list_client_communications. Read-only.",
      ].join(" "),
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        id: z.string().describe("The `id` of a conversation or a call, from list_client_communications."),
        since: z.string().optional().describe("YYYY-MM-DD. Conversation only: messages from this day on."),
        before: z.string().optional().describe("YYYY-MM-DD. Conversation only: messages before this day."),
        limit: z.number().int().min(1).max(MAX_MESSAGES).optional().describe("Conversation only: how many messages. Default 100."),
      }),
      annotations: TOOL_ANNOTATIONS.get_client_communication,
    },
    async (args: { client: string; id: string; since?: string; before?: string; limit?: number }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const id = args.id.trim().slice(0, 100);
        const since = parseDay(args.since, "since");
        if (typeof since === "string") return toolText(since);
        const before = parseDay(args.before, "before");
        if (typeof before === "string") return toolText(before);

        const conversation = await readClientConversation(actor, client.value.id, id, {
          since,
          before,
          limit: Math.min(args.limit ?? 100, MAX_MESSAGES),
        });
        if (!("denied" in conversation)) {
          return toolJson({
            client: conversation.client,
            times: TIMES,
            kind: "whatsapp",
            conversation: {
              id: conversation.conversation.id,
              name: conversation.conversation.name,
              phone: conversation.conversation.phone,
              group: conversation.conversation.isGroup,
              onAnkoraNumberOf: conversation.conversation.ourNumberOwner,
            },
            messages: conversation.messages.map((m) => ({
              at: israelTime(m.at),
              from: m.fromAnkora ? `Ankora${m.sender ? ` (${m.sender})` : ""}` : m.sender || conversation.conversation.name,
              fromAnkora: m.fromAnkora,
              text: m.text,
              ...(m.quotedFrom
                ? {
                    // 15.11.2026: who wrote the quoted message. "unknown" when
                    // WhatsApp hid the number and nothing else tells; never
                    // read a number out of it.
                    replyTo: {
                      from:
                        m.quotedFrom.kind === "us"
                          ? "Ankora"
                          : m.quotedFrom.kind === "name"
                            ? m.quotedFrom.name
                            : "unknown",
                      text: m.quoted ?? "",
                    },
                  }
                : {}),
              ...(m.attachments.length ? { attachments: m.attachments } : {}),
              ...(m.deleted ? { deleted: true } : {}),
              ...(m.edited ? { edited: true } : {}),
              ...(m.forwarded ? { forwarded: true } : {}),
            })),
            hasEarlier: conversation.hasEarlier,
          });
        }
        if (conversation.denied === "no_access") return toolText(deniedText(conversation));

        const call = await readClientCall(actor, client.value.id, id);
        if ("denied" in call) return toolText(deniedText(call));
        const c = call.call;
        return toolJson({
          client: call.client,
          times: TIMES,
          kind: "call",
          call: {
            id: c.id,
            at: israelTime(c.at),
            direction: c.direction === "IN" ? "incoming" : c.direction === "OUT" ? "outgoing" : "unknown",
            phone: c.phone,
            minutes: c.durationSec == null ? null : Math.round((c.durationSec / 60) * 10) / 10,
          },
          transcript: c.transcript.text,
          transcriptStatus:
            c.transcript.status === "DONE"
              ? "ready"
              : c.transcript.status === "SKIPPED"
                ? "not made: the number belongs to a client marked בלי AI"
                : c.transcript.status === "PENDING"
                  ? c.transcript.attempts > 0 && c.transcript.lastError
                    ? `waiting for the nightly run; the last try failed: ${c.transcript.lastError}`
                    : "waiting for the nightly run"
                  : c.transcript.status === "FAILED"
                    ? `failed${c.transcript.lastError ? `: ${c.transcript.lastError}` : ""}; can be retried from the communications screen`
                    : "none",
        });
      } catch (err) {
        console.error("[mcp] get_client_communication failed", err);
        return toolFailure(err);
      }
    },
  );
}

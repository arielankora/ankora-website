import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";

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
        "Returns a client's file as one Markdown document, in Ankora's standard order: identity and legal entities, scope, people, preferences, requirements, systems and access, suppliers, finance, communication, dates, temporary information, one-off decisions, open questions, items awaiting confirmation, recent updates, and the source legend. Lines not yet confirmed say so, with what would confirm them; sources appear as [S1 08:13]. Contact details and sensitive items are left out. Read it before working on a client you have not worked on in this conversation, and before drafting anything to the client or their suppliers.",
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
}

import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { ClientDocumentKind, User } from "@prisma/client";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { actorOf, findTask } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { localDateKey } from "@/lib/timezone";
import { appBaseUrl } from "@/lib/email-templates";
import { FILE_TICKET_TTL_MINUTES, MAX_INLINE_UPLOAD_BYTES, decodeInlineFile, fileTicketUrl } from "@/lib/mcp/file-ticket";
import { resolveByName } from "@/lib/mcp/resolve";
import { setClientDocumentKind } from "@/lib/app-domain/client-documents";
import {
  MAX_INLINE_IMAGE_BYTES,
  fileDocumentFromMcp,
  findDocumentForMcp,
  issueDownloadTicket,
  issueUploadTicket,
  listDocumentsForMcp,
  readDocumentForMcp,
  type McpDocument,
} from "@/lib/app-domain/mcp-files";

// MCP document files (12.10.2026): the client's file, from Claude.
//
// Four tools over ClientDocument, the table behind the client screen's
// "מסמכים" panel and the portal's documents:
//
//   list_documents          what is filed on a client or a task
//   read_document           a document's text (or image), plus a download
//                           address for the bytes
//   upload_document         file a small document, bytes inline as base64
//   start_document_upload   file any document up to 4MB through a one-time
//                           address Claude sends the bytes to itself
//
// Two decisions worth knowing before changing anything here:
//
// A document Claude files is hidden from the client unless the model says
// otherwise, the opposite of the screen's default. On the screen a person
// ticks the box looking at the file; here nobody has looked at it yet, and
// the portal's rule is that nothing reaches the client without a person
// choosing it. Same reasoning as create_task's clientVisible.
//
// Bytes never come back through the model when they can be avoided. Reading
// returns extracted text, which is what the model can use, and an address
// for the file itself; uploading prefers an address over base64. See
// lib/mcp/file-ticket.ts.

const KINDS = ["POLICY", "PROCEDURE", "CERTIFICATE", "CONTRACT", "INVOICE", "OTHER"] as const;

const KIND_LABELS: Record<ClientDocumentKind, string> = {
  POLICY: "פוליסה",
  PROCEDURE: "נוהל",
  CERTIFICATE: "אישור",
  CONTRACT: "חוזה",
  INVOICE: "חשבונית",
  OTHER: "אחר",
};

const TARGET_ARGS = {
  client: z.string().optional().describe("Client name, as the user said it. Not needed when the task is given."),
  task: z.string().optional().describe("Title of the task the document belongs to, when it belongs to one."),
  taskId: z
    .string()
    .optional()
    .describe("The task's exact id, when you have it (an Ankora prompt or an earlier tool result gives it). Preferred over `task`."),
};

type TargetArgs = { client?: string; task?: string; taskId?: string };
type Target = { clientId: string; clientName: string; taskId: string | null; taskTitle: string | null };

/// The client (and task) a document call is about. A task decides its own
/// client; a client named as well must be that one.
async function resolveTarget(actor: User, args: TargetArgs, opts: { clientRequired: boolean }): Promise<{ ok: true; value: Target } | { ok: false; message: string }> {
  if (args.taskId?.trim() || args.task?.trim()) {
    const found = await findTask(actor, { ...args, includeDone: true });
    if (!found.ok) return found;
    return {
      ok: true,
      value: {
        clientId: found.value.clientId,
        clientName: found.value.clientName ?? "",
        taskId: found.value.id,
        taskTitle: found.value.name,
      },
    };
  }
  if (!args.client?.trim()) {
    if (!opts.clientRequired) return { ok: true, value: { clientId: "", clientName: "", taskId: null, taskTitle: null } };
    return { ok: false, message: "Say where the document goes: pass the task (`taskId` or `task`), or the `client`." };
  }
  const client = await lookupClient(actor, args.client);
  if (!client.ok) return client;
  return { ok: true, value: { clientId: client.value.id, clientName: client.value.name, taskId: null, taskTitle: null } };
}

function serializeDocument(d: McpDocument, tz: string) {
  return {
    documentId: d.id,
    title: d.title,
    kind: d.kind,
    kindLabel: KIND_LABELS[d.kind],
    mimeType: d.mimeType,
    sizeKB: d.sizeBytes === null ? null : Math.max(1, Math.round(d.sizeBytes / 1024)),
    client: d.client.name,
    task: d.task?.title ?? null,
    taskId: d.task?.id ?? null,
    clientVisible: d.clientVisible,
    uploadedBy: d.uploadedBy?.name ?? null,
    uploadedOn: localDateKey(d.createdAt, tz),
  };
}

function clientScreenUrl(clientId: string): string {
  return `${appBaseUrl()}/app/clients/${clientId}`;
}

const UPLOAD_FIELDS = {
  ...TARGET_ARGS,
  title: z.string().min(1).max(200).describe("The document's name as people will read it in Ankora, in Hebrew when the user writes Hebrew. Example: 'חוזה העסקה חתום - דנה כהן'."),
  kind: z.enum(KINDS).optional().describe("POLICY (an insurance policy), PROCEDURE (a procedure or process Ankora wrote), CERTIFICATE, CONTRACT, INVOICE or OTHER. Default OTHER."),
  fileName: z.string().min(1).max(200).describe("The file's name with its extension, e.g. 'contract-signed.pdf'. The extension decides how the file opens."),
  mimeType: z.string().optional().describe("Only if you know it for certain. Otherwise omit; Ankora decides from the extension."),
  clientVisible: z
    .boolean()
    .optional()
    .describe("Show the document to the client in their portal. Default false. Pass true only when the user explicitly asked for the client to see it."),
};

type UploadArgs = TargetArgs & {
  title: string;
  kind?: ClientDocumentKind;
  fileName: string;
  mimeType?: string;
  clientVisible?: boolean;
};

export function registerDocumentTools(server: McpServer): void {
  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description:
        "Lists the documents filed in Ankora: on one task (pass `taskId` or `task`), on one client (pass `client`), or the latest across the user's clients. Each comes with a `documentId` for read_document. Use it before advancing a task that has files, and to check that an upload landed.",
      inputSchema: z.object(TARGET_ARGS),
      annotations: TOOL_ANNOTATIONS.list_documents,
    },
    async (args: TargetArgs, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const target = await resolveTarget(actor, args, { clientRequired: false });
        if (!target.ok) return toolText(target.message);
        const docs = await listDocumentsForMcp(actor, {
          clientId: target.value.clientId || undefined,
          taskId: target.value.taskId ?? undefined,
        });
        const tz = actor.timezone || "Asia/Jerusalem";
        return toolJson({ count: docs.length, documents: docs.map((d) => serializeDocument(d, tz)) });
      } catch (err) {
        console.error("[mcp] list_documents failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "set_document_kind",
    {
      title: "Change a document's kind",
      description:
        "Changes what a filed document is: POLICY (an insurance policy), PROCEDURE (a procedure or process Ankora wrote), CERTIFICATE, CONTRACT, INVOICE or OTHER. Use it when a document was filed with the wrong kind, for instance a procedure filed as POLICY or OTHER; the closing reminder says when that happened. Identify the document by `documentId` (list_documents). Internal: the client sees the new kind's label on their portal only if the document is visible to them.",
      inputSchema: z.object({
        documentId: z.string().min(1).describe("The document's exact id, from list_documents."),
        kind: z.enum(KINDS).describe("The kind it should be."),
      }),
      annotations: TOOL_ANNOTATIONS.set_document_kind,
    },
    async (args: { documentId: string; kind: ClientDocumentKind }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        // The same lookup read_document uses, so a document on a client
        // this person cannot see is "not found", not "forbidden".
        const doc = await findDocumentForMcp(actor, args.documentId);
        if (!doc) return toolText(`No document with id "${args.documentId}" that you can see. Call list_documents to find it.`);
        const before = doc.kind;
        await setClientDocumentKind(actor, doc.id, args.kind);
        return toolJson({
          updated: before !== args.kind,
          documentId: doc.id,
          title: doc.title,
          kind: args.kind,
          kindLabel: KIND_LABELS[args.kind],
          previousKind: before,
          client: doc.client.name,
        });
      } catch (err) {
        console.error("[mcp] set_document_kind failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "read_document",
    {
      title: "Read a document",
      description:
        "Reads one document from a client's file in Ankora, so it can be context for the work: a signed form, a quote, a policy. Returns the document's text (PDF, Word, Excel, PowerPoint and text files), or the image itself for a photo or scan image, and always a `downloadUrl` for the original file, valid 15 minutes, needing no sign-in. If you can run commands, `curl -o <file> <downloadUrl>` and open it yourself when the text is not enough (a scanned PDF has no text). Identify it by `documentId` (from list_documents or an Ankora prompt), or by its title with the task or client. Internal: never forward the download address to a client.",
      inputSchema: z.object({
        documentId: z.string().optional().describe("The document's exact id. Preferred."),
        title: z.string().optional().describe("The document's title, or enough of it, when you have no id. Pass the task or client too."),
        ...TARGET_ARGS,
      }),
      annotations: TOOL_ANNOTATIONS.read_document,
    },
    async (args: TargetArgs & { documentId?: string; title?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        let doc: McpDocument | null = null;

        if (args.documentId?.trim()) {
          doc = await findDocumentForMcp(actor, args.documentId);
          if (!doc) return toolText(`No document with id "${args.documentId}" that you can see. Call list_documents to find it.`);
        } else if (args.title?.trim()) {
          const target = await resolveTarget(actor, args, { clientRequired: false });
          if (!target.ok) return toolText(target.message);
          const docs = await listDocumentsForMcp(actor, {
            clientId: target.value.clientId || undefined,
            taskId: target.value.taskId ?? undefined,
          });
          const result = resolveByName(args.title, docs.map((d) => ({ ...d, name: d.title })));
          if (result.status === "none") return toolText(`No document matching "${args.title}". Call list_documents to see what is filed.`);
          if (result.status === "ambiguous") {
            return toolText(
              `Several documents match "${args.title}": ${result.candidates.map((c) => `${c.title} (documentId ${c.id})`).join("; ")}. Call again with the documentId.`
            );
          }
          doc = result.match;
        } else {
          return toolText("Say which document: pass `documentId`, or its `title` with the task or client.");
        }

        const content = await readDocumentForMcp(actor, doc);
        if (!content.ok) return { content: [{ type: "text" as const, text: content.message }], isError: true as const };
        const { ticket, expiresAt } = await issueDownloadTicket(actor, doc);

        const tz = actor.timezone || "Asia/Jerusalem";
        const meta = {
          ...serializeDocument(doc, tz),
          downloadUrl: fileTicketUrl(appBaseUrl(), ticket),
          downloadUrlExpiresAt: expiresAt.toISOString(),
          content:
            content.extracted.kind === "text"
              ? content.extracted.truncated
                ? "Text below, cut at the limit. Download the file for the rest."
                : "Full text below."
              : content.extracted.kind === "image"
                ? content.bytes.byteLength <= MAX_INLINE_IMAGE_BYTES
                  ? "The image follows."
                  : "The image is too large to return here. Download it with downloadUrl."
                : content.extracted.reason + " Download the file with downloadUrl to look at it.",
          ...(content.extracted.kind === "text" && content.extracted.pages ? { pages: content.extracted.pages } : {}),
        };

        const blocks: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
          { type: "text", text: JSON.stringify(meta, null, 2) },
        ];
        if (content.extracted.kind === "text") {
          blocks.push({ type: "text", text: content.extracted.text });
        } else if (content.extracted.kind === "image" && content.bytes.byteLength <= MAX_INLINE_IMAGE_BYTES) {
          blocks.push({ type: "image", data: content.bytes.toString("base64"), mimeType: doc.mimeType });
        }
        return { content: blocks };
      } catch (err) {
        console.error("[mcp] read_document failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "upload_document",
    {
      title: "File a small document (inline)",
      description: `Files a document in a client's file in Ankora, optionally on a task, with the file's bytes inline as base64. Up to ${MAX_INLINE_UPLOAD_BYTES / 1024 / 1024}MB. If you can run commands (curl), prefer start_document_upload: it takes files up to 4MB and costs no tokens for the bytes. Use this one when you cannot. The document is hidden from the client unless \`clientVisible: true\`. Calling this twice files two documents, so confirm the title and destination with the user first.`,
      inputSchema: z.object({
        ...UPLOAD_FIELDS,
        contentBase64: z.string().min(1).describe("The whole file, base64-encoded, unchanged. A data: URL prefix is accepted."),
      }),
      annotations: TOOL_ANNOTATIONS.upload_document,
    },
    async (args: UploadArgs & { contentBase64: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const decoded = decodeInlineFile(args.contentBase64);
        if (!decoded.ok) return toolText(decoded.message);
        const target = await resolveTarget(actor, args, { clientRequired: true });
        if (!target.ok) return toolText(target.message);

        const doc = await fileDocumentFromMcp(
          actor,
          {
            clientId: target.value.clientId,
            taskId: target.value.taskId,
            title: args.title,
            kind: args.kind ?? "OTHER",
            fileName: args.fileName,
            mimeType: args.mimeType,
            clientVisible: args.clientVisible ?? false,
          },
          decoded.content
        );
        return toolJson({
          filed: true,
          documentId: doc.id,
          title: doc.title,
          client: target.value.clientName,
          task: target.value.taskTitle,
          sizeKB: Math.max(1, Math.round(decoded.content.byteLength / 1024)),
          clientVisible: doc.clientVisible,
          clientFileUrl: clientScreenUrl(target.value.clientId),
        });
      } catch (err) {
        console.error("[mcp] upload_document failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "start_document_upload",
    {
      title: "File a document (upload address)",
      description: `Starts filing a document in a client's file in Ankora, optionally on a task, and returns a one-time \`uploadUrl\`. Send the file's raw bytes there yourself, from your own environment: \`curl -sS -T <file> <uploadUrl>\`. The response says whether it was filed and gives its documentId. Up to 4MB, valid ${FILE_TICKET_TTL_MINUTES} minutes, files exactly one document; if the upload fails the address can be retried until it expires. The preferred way to upload whenever you can run commands. The document is hidden from the client unless \`clientVisible: true\`. Never show the address to anyone else.`,
      inputSchema: z.object(UPLOAD_FIELDS),
      annotations: TOOL_ANNOTATIONS.start_document_upload,
    },
    async (args: UploadArgs, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const target = await resolveTarget(actor, args, { clientRequired: true });
        if (!target.ok) return toolText(target.message);

        const { ticket, expiresAt } = await issueUploadTicket(actor, {
          clientId: target.value.clientId,
          taskId: target.value.taskId,
          title: args.title,
          kind: args.kind ?? "OTHER",
          fileName: args.fileName,
          mimeType: args.mimeType,
          clientVisible: args.clientVisible ?? false,
        });
        const uploadUrl = fileTicketUrl(appBaseUrl(), ticket);
        return toolJson({
          uploadUrl,
          expiresAt: expiresAt.toISOString(),
          method: "PUT, the file's raw bytes as the body",
          example: `curl -sS -T "${args.fileName}" "${uploadUrl}"`,
          maxMB: 4,
          client: target.value.clientName,
          task: target.value.taskTitle,
          title: args.title.trim(),
          clientVisible: args.clientVisible ?? false,
          next: "Run the upload, then tell the user it was filed only if the response says filed: true.",
        });
      } catch (err) {
        console.error("[mcp] start_document_upload failed", err);
        return toolFailure(err);
      }
    }
  );
}


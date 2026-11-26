import "server-only";
import type { User } from "@prisma/client";
import { DomainError } from "@/lib/domain-error";
import { guarded, resolveMailbox, used } from "./mailbox";
import {
  createDraft,
  createFolder,
  createOutlookCategory,
  deleteDraft,
  deleteFolder,
  deleteOutlookCategory,
  getAttachment,
  getDraft,
  getEmail,
  listDrafts,
  markEmail,
  modifyEmail,
  readMailAccount,
  sendDraft,
  sendEmail,
  trashEmail,
  updateDraft,
  updateFolder,
  type Address,
  type OutgoingEmail,
  type OutgoingFile,
  type RawEmail,
} from "./unipile-mail";
import { addressOf, attachmentsOf, folderOf, forwardedText, fullOf, htmlFromText, prefixedSubject, rawAddresses, summaryOf } from "./shape";

// Writing to a client's mailbox through the connector (stage 2, 26.11.2026,
// Ariel: "להמליץ על טיוטה אבל לאפשר גם שליחה בבקשה מפורשת").
//
// - A draft is the default: it lands in the client's own Drafts, where a
//   person can read it and send it themselves.
// - Sending goes out only when the call says the user asked, in so many
//   words, to send. Without that it is refused, and the refusal tells Claude
//   to make a draft instead. The connector also marks the tool destructive,
//   so Claude's client asks before every send.
// - Forwarding is built here: Unipile has no forward for email, so the
//   original's files are fetched and attached to a new message, under the
//   original quoted as mail programs do.
// - Open and click tracking is not offered: it needs a webhook to receive
//   its events, and Ankora has none for mail.
// - Every write is audited on the connection ("connection.mail_write"),
//   with what was done, to whom and on which item, never the text.

/// What a forward may carry in total. Gmail takes 25MB; base64 grows by a
/// third, so 18MB of files is what fits in one message.
export const MAX_FORWARD_BYTES = 18 * 1024 * 1024;

export type Compose = {
  mailbox?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  /// The address to send from, when the mailbox has more than one.
  from?: string;
  /// Answer this email, in its thread.
  replyToEmailId?: string;
  /// Answer everyone on it, not only its sender.
  replyAll?: boolean;
  /// Forward this email, with its files.
  forwardEmailId?: string;
  /// Ids of the forwarded email's files to leave out.
  dropAttachmentIds?: string[];
};

function addresses(list: string[] | undefined, field: string): Address[] {
  const out: Address[] = [];
  for (const raw of list ?? []) {
    const a = addressOf(raw);
    if (!a) throw new DomainError("connections.mailbox.badAddress", `הכתובת "${raw}" ב-${field} לא תקינה.`, { address: raw, field });
    out.push(a);
  }
  return out;
}

const lower = (a: Address) => a.email.toLowerCase();

/// The message Unipile sends or saves: the people, the subject, the text in
/// both parts, and for a reply or a forward what the original contributes.
async function compose(accountId: string, mailboxAddress: string, input: Compose): Promise<{ email: OutgoingEmail; kind: "new" | "reply" | "forward"; original: RawEmail | null }> {
  if (input.replyToEmailId && input.forwardEmailId) {
    throw new DomainError("connections.mailbox.replyOrForward", "מייל הוא תשובה או העברה, לא שניהם.");
  }
  let to = addresses(input.to, "to");
  let cc = addresses(input.cc, "cc");
  const bcc = addresses(input.bcc, "bcc");
  let subject = input.subject?.trim() ?? "";
  let text = input.text ?? "";
  let original: RawEmail | null = null;
  let attachments: OutgoingFile[] | undefined;
  let kind: "new" | "reply" | "forward" = "new";
  const email: OutgoingEmail = {};

  if (input.replyToEmailId) {
    kind = "reply";
    original = await getEmail(accountId, input.replyToEmailId);
    if (to.length === 0) {
      // Reply goes to Reply-To when the sender set one, as mail programs do.
      const replyTo = rawAddresses(original.reply_to);
      to = replyTo.length ? replyTo : rawAddresses(original.from);
      if (input.replyAll) {
        const mine = mailboxAddress.toLowerCase();
        const taken = new Set([...to.map(lower), mine]);
        const others = [...rawAddresses(original.to), ...rawAddresses(original.cc)].filter((a) => !taken.has(lower(a)) && taken.add(lower(a)));
        cc = [...cc, ...others];
      }
      // A reply to a mail the mailbox itself sent goes to that mail's
      // recipients, not back to itself.
      if (to.every((a) => lower(a) === mailboxAddress.toLowerCase())) to = rawAddresses(original.to);
    }
    if (!subject) subject = prefixedSubject("Re", original.subject);
    email.reply_to_provider_id = input.replyToEmailId;
  }

  if (input.forwardEmailId) {
    kind = "forward";
    original = await getEmail(accountId, input.forwardEmailId);
    if (!subject) subject = prefixedSubject("Fwd", original.subject);
    text = forwardedText(text, original);
    const drop = new Set(input.dropAttachmentIds ?? []);
    const files = attachmentsOf(original.attachments).filter((a) => !a.inline && !a.unavailable && !drop.has(a.id));
    let total = 0;
    attachments = [];
    for (const f of files) {
      const file = await getAttachment(accountId, input.forwardEmailId, f.id);
      total += file.content.length;
      if (total > MAX_FORWARD_BYTES) {
        throw new DomainError("connections.mailbox.forwardTooLarge", "הקבצים במייל המקורי גדולים מדי להעברה בהודעה אחת (מעל 18MB). אפשר להוריד חלק מהם עם dropAttachmentIds.");
      }
      attachments.push({ filename: f.fileName ?? "attachment", content_type: f.mimeType ?? file.mimeType, content: file.content.toString("base64") });
    }
  }

  if (to.length === 0) throw new DomainError("connections.mailbox.noRecipient", "אין נמען. כותבים למי לשלוח ב-to.");
  if (!text.trim()) throw new DomainError("connections.mailbox.noText", "אין תוכן למייל. כותבים את הטקסט ב-text.");

  Object.assign(email, {
    to,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    subject,
    plain_text: text,
    html: htmlFromText(text),
    ...(attachments?.length ? { attachments } : {}),
  });
  if (input.from) {
    const from = addressOf(input.from);
    if (!from) throw new DomainError("connections.mailbox.badAddress", `הכתובת "${input.from}" ב-from לא תקינה.`, { address: input.from, field: "from" });
    email.from = from;
  }
  return { email, kind, original };
}

function who(e: OutgoingEmail) {
  return { to: (e.to ?? []).map(lower), cc: (e.cc ?? []).map(lower), bcc: (e.bcc ?? []).length, attachments: (e.attachments ?? []).map((a) => a.filename) };
}

// ---------------------------------------------------------------- drafts

export async function listClientDrafts(actor: User, clientId: string, input: { mailbox?: string; draftId?: string; participant?: string; cursor?: string; limit?: number }) {
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  if (input.draftId) {
    const draft = await guarded(row, () => getDraft(row.unipileAccountId, input.draftId!));
    await used(actor, row, "draft", { draftId: input.draftId });
    return { mailbox: row.account, drafts: fullOf([draft]) };
  }
  const page = await guarded(row, () =>
    listDrafts(row.unipileAccountId, { any_email: input.participant?.trim() || undefined, cursor: input.cursor || undefined, limit: Math.min(Math.max(input.limit ?? 25, 1), 100) }),
  );
  await used(actor, row, "drafts", { count: page.items.length });
  return { mailbox: row.account, drafts: page.items.map(summaryOf).filter(Boolean), nextCursor: page.nextCursor };
}

export async function saveClientDraft(actor: User, clientId: string, input: Compose & { draftId?: string; delete?: boolean }) {
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  if (input.delete) {
    if (!input.draftId) throw new DomainError("connections.mailbox.draftIdRequired", "כדי למחוק טיוטה מעבירים את המזהה שלה ב-draftId.");
    await guarded(row, () => deleteDraft(row.unipileAccountId, input.draftId!));
    await used(actor, row, "draft_delete", { draftId: input.draftId }, "mail_write");
    return { mailbox: row.account, deleted: input.draftId };
  }
  const { email, kind } = await guarded(row, () => compose(row.unipileAccountId, row.account, input));
  const draft = input.draftId
    ? await guarded(row, () => updateDraft(row.unipileAccountId, input.draftId!, email))
    : await guarded(row, () => createDraft(row.unipileAccountId, email));
  const id = summaryOf(draft)?.id ?? input.draftId ?? null;
  await used(actor, row, input.draftId ? "draft_update" : "draft_create", { draftId: id, kind, ...who(email) }, "mail_write");
  return {
    mailbox: row.account,
    draftId: id,
    kind,
    to: (email.to ?? []).map((a) => a.email),
    cc: (email.cc ?? []).map((a) => a.email),
    subject: email.subject,
    attachments: (email.attachments ?? []).map((a) => a.filename),
    saved: "In the mailbox's Drafts. Show it to the user; it is sent only with send_client_email and their explicit request, or by a person from the mailbox.",
  };
}

// ---------------------------------------------------------------- send

export async function sendClientEmail(actor: User, clientId: string, input: Compose & { draftId?: string; userAskedToSend?: boolean }) {
  if (input.userAskedToSend !== true) {
    throw new DomainError(
      "connections.mailbox.sendNotAsked",
      "שליחה ישירה רק כשהמשתמש ביקש במפורש לשלוח. בלי בקשה כזו מכינים טיוטה (save_client_email_draft) ומראים אותה למשתמש.",
    );
  }
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  if (input.draftId) {
    const draft = await guarded(row, () => getDraft(row.unipileAccountId, input.draftId!));
    const sent = await guarded(row, () => sendDraft(row.unipileAccountId, input.draftId!));
    await used(actor, row, "send_draft", { draftId: input.draftId, sentId: sent.id, to: rawAddresses(draft.to).map(lower), cc: rawAddresses(draft.cc).map(lower) }, "mail_write");
    return { mailbox: row.account, sent: true, kind: "draft", emailId: sent.id, to: rawAddresses(draft.to).map((a) => a.email), subject: summaryOf(draft)?.subject ?? null };
  }
  const { email, kind } = await guarded(row, () => compose(row.unipileAccountId, row.account, input));
  const sent = await guarded(row, () => sendEmail(row.unipileAccountId, email));
  await used(actor, row, "send", { kind, sentId: sent.id, replyTo: input.replyToEmailId ?? null, forwarded: input.forwardEmailId ?? null, ...who(email) }, "mail_write");
  return {
    mailbox: row.account,
    sent: true,
    kind,
    emailId: sent.id,
    to: (email.to ?? []).map((a) => a.email),
    cc: (email.cc ?? []).map((a) => a.email),
    subject: email.subject,
    attachments: (email.attachments ?? []).map((a) => a.filename),
  };
}

// ---------------------------------------------------------------- organise

export type OrganizeAction = "mark_read" | "mark_unread" | "set_folders" | "add_folders" | "remove_folders" | "set_categories" | "trash";

export async function organizeClientEmail(
  actor: User,
  clientId: string,
  input: { mailbox?: string; emailIds: string[]; action: OrganizeAction; folderIds?: string[]; categories?: string[] },
) {
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  const ids = [...new Set(input.emailIds)].slice(0, 50);
  if (ids.length === 0) throw new DomainError("connections.mailbox.idRequired", "מעבירים מזהה של מייל או של שרשור.");
  const account = await guarded(row, () => readMailAccount(row.unipileAccountId));
  if (input.action === "set_categories" && account.provider !== "outlook") {
    throw new DomainError("connections.mailbox.outlookOnly", "קטגוריות קיימות רק בתיבות של Outlook. ב-Gmail משתמשים בתוויות (folderIds).");
  }
  if (["set_folders", "add_folders", "remove_folders"].includes(input.action) && !input.folderIds) {
    throw new DomainError("connections.mailbox.foldersRequired", "מעבירים את מזהי התיקיות או התוויות ב-folderIds (מ-list_client_mail_folders).");
  }
  const done: string[] = [];
  for (const id of ids) {
    await guarded(row, async () => {
      if (input.action === "mark_read" || input.action === "mark_unread") return markEmail(row.unipileAccountId, id, input.action === "mark_read");
      if (input.action === "trash") return trashEmail(row.unipileAccountId, id);
      if (input.action === "set_categories") return modifyEmail(row.unipileAccountId, id, { outlookCategories: input.categories ?? [] });
      // Unipile replaces the whole set; adding and removing start from the
      // email's own folders.
      let folders = input.folderIds ?? [];
      if (input.action !== "set_folders") {
        const current = summaryOf(await getEmail(row.unipileAccountId, id))?.folders ?? [];
        const change = new Set(folders);
        folders = input.action === "add_folders" ? [...new Set([...current, ...folders])] : current.filter((f) => !change.has(f));
      }
      return modifyEmail(row.unipileAccountId, id, { folders_ids: folders });
    });
    done.push(id);
  }
  await used(actor, row, input.action, { emailIds: done, folderIds: input.folderIds ?? null, categories: input.categories ?? null }, "mail_write");
  return { mailbox: row.account, action: input.action, emailIds: done, ...(input.emailIds.length > 50 ? { note: "Only the first 50 emails were changed. Call again for the rest." } : {}) };
}

export async function manageClientMailFolders(
  actor: User,
  clientId: string,
  input: {
    mailbox?: string;
    action: "create_folder" | "update_folder" | "delete_folder" | "create_category" | "delete_category";
    folderId?: string;
    name?: string;
    parentId?: string;
    textColor?: string;
    backgroundColor?: string;
    color?: string;
  },
) {
  const row = await resolveMailbox(actor, clientId, input.mailbox);
  const account = await guarded(row, () => readMailAccount(row.unipileAccountId));
  const a = row.unipileAccountId;
  const style = { ...(input.parentId ? { parent_id: input.parentId } : {}), ...(input.textColor ? { text_color: input.textColor } : {}), ...(input.backgroundColor ? { background_color: input.backgroundColor } : {}) };
  let result: Record<string, unknown> = {};
  if (input.action === "create_category" || input.action === "delete_category") {
    if (account.provider !== "outlook") throw new DomainError("connections.mailbox.outlookOnly", "קטגוריות קיימות רק בתיבות של Outlook. ב-Gmail משתמשים בתוויות (folderIds).");
    if (!input.name?.trim()) throw new DomainError("connections.mailbox.nameRequired", "מעבירים שם ב-name.");
    if (input.action === "create_category") await guarded(row, () => createOutlookCategory(a, { name: input.name!.trim(), ...(input.color ? { color: input.color } : {}) }));
    else await guarded(row, () => deleteOutlookCategory(a, input.name!.trim()));
    result = { category: input.name.trim() };
  } else if (input.action === "create_folder") {
    if (!input.name?.trim()) throw new DomainError("connections.mailbox.nameRequired", "מעבירים שם ב-name.");
    result = { folder: folderOf(await guarded(row, () => createFolder(a, { name: input.name!.trim(), ...style }))) };
  } else {
    if (!input.folderId) throw new DomainError("connections.mailbox.folderIdRequired", "מעבירים את מזהה התיקייה ב-folderId (מ-list_client_mail_folders).");
    if (input.action === "update_folder") result = { folder: folderOf(await guarded(row, () => updateFolder(a, input.folderId!, { ...(input.name?.trim() ? { name: input.name.trim() } : {}), ...style }))) };
    else {
      await guarded(row, () => deleteFolder(a, input.folderId!));
      result = { deleted: input.folderId };
    }
  }
  await used(actor, row, input.action, { folderId: input.folderId ?? null, name: input.name ?? null }, "mail_write");
  return { mailbox: row.account, action: input.action, ...result };
}

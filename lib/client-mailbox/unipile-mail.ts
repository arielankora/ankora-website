import "server-only";
import { DomainError } from "@/lib/domain-error";
import { readPocConfig } from "@/lib/whatsapp-poc/unipile";

// A client's mailbox and calendar through Unipile (26.11.2026, Ariel and
// Hadas): the thin HTTP layer. Nothing here knows about people or clients;
// lib/client-mailbox/mailbox.ts decides who may call what.
//
// The API key is the deployment's UNIPILE_API_KEY, the same one the
// WhatsApp screens use. It reaches every account of Ankora's Unipile
// application, which is why it stays on the server and Claude never gets
// Unipile's own connector: the permissions are Ankora's.
//
// Unipile's answers can echo addresses and subjects, so an error keeps only
// the HTTP status, never the body.

const BASE_URL = "https://api.unipile.com/v2";
const TIMEOUT_MS = 20_000;
/// Attachments are read whole into memory to extract their text.
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/// The providers a client mailbox may be (Unipile v2). Calendar only on
/// the two OAuth ones; IMAP is mail only.
export const MAIL_PROVIDERS = ["google", "outlook", "imap"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export function isMailProvider(p: string): p is MailProvider {
  return (MAIL_PROVIDERS as readonly string[]).includes(p.toLowerCase());
}

/// What a mailbox of this provider can do, stored on the connection row.
export function capabilitiesOf(provider: MailProvider): string[] {
  return provider === "imap" ? ["mail"] : ["mail", "calendar"];
}

function apiKey(): string {
  const key = readPocConfig().apiKey;
  if (!key) throw new DomainError("connections.mailbox.notConfigured", "החיבור דרך Unipile לא מוגדר בסביבה הזו.");
  return key;
}

export function unipileConfigured(): boolean {
  return Boolean(readPocConfig().apiKey);
}

type Query = Record<string, string | number | boolean | undefined | null>;

export class UnipileMailError extends DomainError {
  constructor(
    code: string,
    message: string,
    readonly status: number | null,
    values: Record<string, string | number> = {},
  ) {
    super(code, message, values);
    this.name = "UnipileMailError";
  }
}

async function request(path: string, init: { method?: string; query?: Query; body?: unknown; accept?: string } = {}): Promise<Response> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        "X-API-KEY": apiKey(),
        accept: init.accept ?? "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new UnipileMailError("connections.mailbox.noAnswer", "Unipile לא ענה. נסו שוב בעוד רגע.", null);
  }
  if (response.ok) return response;
  if (response.status === 429) {
    throw new UnipileMailError("connections.mailbox.rateLimited", "Unipile מגביל כרגע את קצב הבקשות לתיבה. נסו שוב בעוד כמה דקות.", 429);
  }
  if (response.status === 404) {
    throw new UnipileMailError("connections.mailbox.itemNotFound", "הפריט לא נמצא בתיבה. אולי נמחק, או שהמזהה לא נכון.", 404);
  }
  throw new UnipileMailError("connections.mailbox.status", `Unipile החזיר שגיאה ${response.status}.`, response.status, { status: response.status });
}

async function json<T>(path: string, init?: { method?: string; query?: Query; body?: unknown }): Promise<T> {
  return (await (await request(path, init)).json()) as T;
}

// ---------------------------------------------------------------- accounts

export type MailAccount = {
  id: string;
  provider: string;
  status: string;
  /// Usually the address ("jobs@client.com").
  name: string | null;
  createdAt: string | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function readMailAccount(accountId: string): Promise<MailAccount> {
  const a = await json<Record<string, unknown>>(`/accounts/${encodeURIComponent(accountId)}`);
  return {
    id: str(a.id) ?? accountId,
    provider: (str(a.provider) ?? "").toLowerCase(),
    status: str(a.status) ?? "",
    name: str(a.name) ?? str(a.user_id),
    createdAt: str(a.created_at),
  };
}

/// "running" is the only state in which the mailbox answers (Unipile v2:
/// running, errored, disconnected, degraded, partial).
export function mailboxNeedsReconnect(status: string): boolean {
  return status === "disconnected" || status === "errored" || status === "partial";
}

/// Removes the account at Unipile: its tokens are dropped and it stops
/// being billed. Already gone counts as removed.
export async function removeMailAccount(accountId: string): Promise<void> {
  try {
    await request(`/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof UnipileMailError && err.status === 404) return;
    throw err;
  }
}

/// A Hosted Auth link: a new mailbox, or the reconnect of an existing one.
export async function createMailboxLink(input: {
  redirectUri: string;
  expiresOn: string;
  state: string;
  reconnectAccountId?: string | null;
}): Promise<string> {
  const body = input.reconnectAccountId
    ? { account_id: input.reconnectAccountId, expires_on: input.expiresOn, redirect_uri: input.redirectUri, state: input.state }
    : { providers: [...MAIL_PROVIDERS], expires_on: input.expiresOn, redirect_uri: input.redirectUri, state: input.state };
  const { link } = await json<{ link: string }>("/auth/link", { method: "POST", body });
  return link;
}

// ---------------------------------------------------------------- mail

export type RawPerson = { email?: unknown; display_name?: unknown };
export type RawAttachment = {
  id?: unknown;
  type?: unknown;
  filename?: unknown;
  mimetype?: unknown;
  file_size?: unknown;
  is_inline?: unknown;
  is_unavailable?: unknown;
};
export type RawEmail = {
  id?: unknown;
  thread_id?: unknown;
  date?: unknown;
  subject?: unknown;
  snippet?: unknown;
  body_plain?: unknown;
  body?: unknown;
  from?: RawPerson[] | unknown;
  to?: RawPerson[] | unknown;
  cc?: RawPerson[] | unknown;
  bcc?: RawPerson[] | unknown;
  reply_to?: RawPerson[] | unknown;
  attachments?: RawAttachment[] | unknown;
  folders?: unknown;
  categories?: unknown;
  is_unread?: unknown;
};

export type EmailFilters = {
  q?: string;
  from?: string;
  to?: string;
  any_email?: string;
  has_attachment?: boolean;
  is_unread?: boolean;
  is_starred?: boolean;
  after?: string;
  before?: string;
  exclude_folder?: string;
  cursor?: string;
  limit?: number;
};

export type Page<T> = { items: T[]; nextCursor: string | null; total: number | null };

function page<T>(raw: { data?: unknown; items?: unknown; next_cursor?: unknown; total_count?: unknown }): Page<T> {
  const list = Array.isArray(raw.data) ? raw.data : Array.isArray(raw.items) ? raw.items : [];
  return {
    items: list as T[],
    nextCursor: str(raw.next_cursor),
    total: typeof raw.total_count === "number" ? raw.total_count : null,
  };
}

/// Emails, newest first. A folder or an Outlook category narrows the list
/// to it; the filters are Unipile's own.
export async function listEmails(
  accountId: string,
  filters: EmailFilters,
  scope: { folderId?: string | null; outlookCategory?: string | null } = {},
): Promise<Page<RawEmail>> {
  const a = encodeURIComponent(accountId);
  const path = scope.folderId
    ? `/${a}/folders/${encodeURIComponent(scope.folderId)}/emails`
    : scope.outlookCategory
      ? `/${a}/outlook/email-categories/${encodeURIComponent(scope.outlookCategory)}/emails`
      : `/${a}/emails`;
  return page<RawEmail>(await json(path, { query: { ...filters, meta_only: false } }));
}

export async function getEmail(accountId: string, emailId: string): Promise<RawEmail> {
  return json<RawEmail>(`/${encodeURIComponent(accountId)}/emails/${encodeURIComponent(emailId)}`);
}

export async function getThread(accountId: string, threadId: string): Promise<{ id: string; emails: RawEmail[] }> {
  const t = await json<{ id?: unknown; emails?: unknown }>(`/${encodeURIComponent(accountId)}/threads/${encodeURIComponent(threadId)}`);
  return { id: str(t.id) ?? threadId, emails: Array.isArray(t.emails) ? (t.emails as RawEmail[]) : [] };
}

export async function getAttachment(accountId: string, emailId: string, attachmentId: string): Promise<{ content: Buffer; mimeType: string }> {
  const res = await request(
    `/${encodeURIComponent(accountId)}/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { accept: "*/*" },
  );
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_ATTACHMENT_BYTES) {
    throw new DomainError("connections.mailbox.attachmentTooLarge", "הקובץ המצורף גדול מ-15MB, ואנקורה לא קוראת אותו מכאן.");
  }
  const content = Buffer.from(await res.arrayBuffer());
  if (content.length > MAX_ATTACHMENT_BYTES) {
    throw new DomainError("connections.mailbox.attachmentTooLarge", "הקובץ המצורף גדול מ-15MB, ואנקורה לא קוראת אותו מכאן.");
  }
  return { content, mimeType: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim() };
}

// ---------------------------------------------------------------- setup

export type RawFolder = { id?: unknown; name?: unknown; role?: unknown; parent_id?: unknown; unread_count?: unknown; total_count?: unknown; is_system?: unknown };
export type RawSender = { email?: unknown; display_name?: unknown; is_default?: unknown; is_primary?: unknown };
export type RawContact = { id?: unknown; display_name?: unknown; first_name?: unknown; last_name?: unknown; company_name?: unknown; job_title?: unknown; emails?: unknown; phone_numbers?: unknown };
export type RawCategory = { name?: unknown; display_name?: unknown; color?: unknown };

export async function listFolders(accountId: string, cursor?: string): Promise<Page<RawFolder>> {
  return page<RawFolder>(await json(`/${encodeURIComponent(accountId)}/folders`, { query: { cursor, limit: 100 } }));
}

export async function listSenders(accountId: string): Promise<RawSender[]> {
  return page<RawSender>(await json(`/${encodeURIComponent(accountId)}/email-senders`)).items;
}

export async function listContacts(accountId: string, cursor?: string, limit = 100): Promise<Page<RawContact>> {
  return page<RawContact>(await json(`/${encodeURIComponent(accountId)}/contacts`, { query: { cursor, limit } }));
}

export async function listOutlookCategories(accountId: string): Promise<RawCategory[]> {
  const raw = await json<unknown>(`/${encodeURIComponent(accountId)}/outlook/email-categories`);
  if (Array.isArray(raw)) return raw as RawCategory[];
  return page<RawCategory>(raw as { data?: unknown }).items;
}

// ---------------------------------------------------------------- writing (stage 2)

export type Address = { email: string; display_name?: string };
export type OutgoingFile = { filename: string; content_type: string; content: string };
export type OutgoingEmail = {
  to?: Address[];
  cc?: Address[];
  bcc?: Address[];
  reply_to?: Address[];
  from?: Address;
  subject?: string;
  plain_text?: string;
  html?: string;
  reply_to_provider_id?: string;
  reply_to_message_id?: string;
  attachments?: OutgoingFile[];
};

export async function sendEmail(accountId: string, email: OutgoingEmail): Promise<{ id: string | null }> {
  const r = await json<{ id?: unknown }>(`/${encodeURIComponent(accountId)}/emails/send`, { method: "POST", body: email });
  return { id: str(r.id) };
}

export type RawDraft = RawEmail;

export async function listDrafts(accountId: string, query: { any_email?: string; cursor?: string; limit?: number }): Promise<Page<RawDraft>> {
  return page<RawDraft>(await json(`/${encodeURIComponent(accountId)}/drafts`, { query }));
}

export async function getDraft(accountId: string, draftId: string): Promise<RawDraft> {
  return json<RawDraft>(`/${encodeURIComponent(accountId)}/drafts/${encodeURIComponent(draftId)}`);
}

export async function createDraft(accountId: string, draft: OutgoingEmail): Promise<RawDraft> {
  // Drafts take the deprecated name for the email they answer.
  const { reply_to_provider_id, ...rest } = draft;
  return json<RawDraft>(`/${encodeURIComponent(accountId)}/drafts`, {
    method: "POST",
    body: { ...rest, ...(reply_to_provider_id ? { reply_to_message_id: reply_to_provider_id } : {}) },
  });
}

export async function updateDraft(accountId: string, draftId: string, draft: OutgoingEmail): Promise<RawDraft> {
  const { reply_to_provider_id: _ignored, ...rest } = draft;
  return json<RawDraft>(`/${encodeURIComponent(accountId)}/drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", body: rest });
}

export async function deleteDraft(accountId: string, draftId: string): Promise<void> {
  await request(`/${encodeURIComponent(accountId)}/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
}

export async function sendDraft(accountId: string, draftId: string): Promise<{ id: string | null }> {
  const r = await json<{ id?: unknown }>(`/${encodeURIComponent(accountId)}/drafts/${encodeURIComponent(draftId)}/send`, { method: "POST", body: {} });
  return { id: str(r.id) };
}

export async function markEmail(accountId: string, emailId: string, read: boolean): Promise<void> {
  await request(`/${encodeURIComponent(accountId)}/emails/${encodeURIComponent(emailId)}/${read ? "read" : "unread"}`, { method: "POST", body: {} });
}

export async function modifyEmail(accountId: string, emailId: string, change: { folders_ids?: string[]; outlookCategories?: string[] }): Promise<void> {
  const body: Record<string, unknown> = {};
  if (change.folders_ids) body.folders_ids = change.folders_ids;
  if (change.outlookCategories) body.specifics = { outlook: { categories: change.outlookCategories } };
  await request(`/${encodeURIComponent(accountId)}/emails/${encodeURIComponent(emailId)}/modify`, { method: "POST", body });
}

export async function trashEmail(accountId: string, emailId: string): Promise<void> {
  await request(`/${encodeURIComponent(accountId)}/emails/${encodeURIComponent(emailId)}`, { method: "DELETE" });
}

export type FolderChange = { name?: string; parent_id?: string; text_color?: string; background_color?: string };

export async function createFolder(accountId: string, folder: FolderChange & { name: string }): Promise<RawFolder> {
  return json<RawFolder>(`/${encodeURIComponent(accountId)}/folders`, { method: "POST", body: folder });
}

export async function updateFolder(accountId: string, folderId: string, folder: FolderChange): Promise<RawFolder> {
  return json<RawFolder>(`/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folderId)}`, { method: "PATCH", body: folder });
}

export async function deleteFolder(accountId: string, folderId: string): Promise<void> {
  await request(`/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
}

export async function createOutlookCategory(accountId: string, category: { name: string; color?: string }): Promise<void> {
  await request(`/${encodeURIComponent(accountId)}/outlook/email-categories`, { method: "POST", body: category });
}

export async function deleteOutlookCategory(accountId: string, name: string): Promise<void> {
  await request(`/${encodeURIComponent(accountId)}/outlook/email-categories/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------- calendar (stage 2)

export type RawCalendar = { id?: unknown; name?: unknown; description?: unknown; is_read_only?: unknown; is_owned_by_user?: unknown; is_default?: unknown; timezone?: unknown };
export type RawEventTime = { type?: unknown; date_time?: unknown; date?: unknown; timezone?: unknown };
export type RawEvent = {
  id?: unknown;
  calendar_id?: unknown;
  master_event_id?: unknown;
  title?: unknown;
  body?: unknown;
  location?: unknown;
  is_cancelled?: unknown;
  is_all_day?: unknown;
  start?: RawEventTime | unknown;
  end?: RawEventTime | unknown;
  attendees?: unknown;
  organizer?: unknown;
  conference?: unknown;
  recurrence?: unknown;
  visibility?: unknown;
  transparency?: unknown;
  timezone?: unknown;
};

export type CalendarChange = { name?: string; description?: string; background_color?: string; timezone?: string };
export type EventTime = { type: "datetime"; date_time: string; timezone?: string } | { type: "date"; date: string; timezone?: string };
export type EventChange = {
  title?: string;
  body?: string;
  location?: string;
  start?: EventTime;
  end?: EventTime;
  timezone?: string;
  attendees?: { email: string; type?: "required" | "optional" }[];
  recurrence?: string[];
  conference?: { provider: "google_meet" | "zoom" | "skype" | "teams" | "unknown"; url?: string };
  transparency?: "opaque" | "transparent";
  visibility?: "public" | "private";
  is_attendees_list_hidden?: boolean;
  notify?: "all" | "externalOnly" | "none";
};

const cal = (accountId: string, calendarId?: string) =>
  `/${encodeURIComponent(accountId)}/calendars${calendarId ? `/${encodeURIComponent(calendarId)}` : ""}`;

export async function listCalendars(accountId: string): Promise<RawCalendar[]> {
  return page<RawCalendar>(await json(cal(accountId), { query: { limit: 100 } })).items;
}

export async function createCalendar(accountId: string, change: CalendarChange & { name: string }): Promise<RawCalendar> {
  return json<RawCalendar>(cal(accountId), { method: "POST", body: change });
}

export async function updateCalendar(accountId: string, calendarId: string, change: CalendarChange): Promise<RawCalendar> {
  return json<RawCalendar>(cal(accountId, calendarId), { method: "PATCH", body: change });
}

export async function deleteCalendar(accountId: string, calendarId: string): Promise<void> {
  await request(cal(accountId, calendarId), { method: "DELETE" });
}

export type EventFilters = {
  start?: string;
  end?: string;
  title?: string;
  description?: string;
  location?: string;
  attendees?: string;
  busy?: boolean;
  is_cancelled?: boolean;
  expand_recurring?: boolean;
  updated_after?: string;
  ical_uid?: string;
  cursor?: string;
  limit?: number;
};

export async function listEvents(accountId: string, calendarId: string, filters: EventFilters): Promise<Page<RawEvent>> {
  return page<RawEvent>(await json(`${cal(accountId, calendarId)}/events`, { query: filters }));
}

export async function getEvent(accountId: string, calendarId: string, eventId: string): Promise<RawEvent> {
  return json<RawEvent>(`${cal(accountId, calendarId)}/events/${encodeURIComponent(eventId)}`);
}

export async function createEvent(accountId: string, calendarId: string, event: EventChange): Promise<RawEvent> {
  return json<RawEvent>(`${cal(accountId, calendarId)}/events`, { method: "POST", body: event });
}

export async function updateEvent(accountId: string, calendarId: string, eventId: string, event: EventChange): Promise<RawEvent> {
  return json<RawEvent>(`${cal(accountId, calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: event });
}

export async function eventAction(
  accountId: string,
  calendarId: string,
  eventId: string,
  action: { kind: "rsvp"; status: "yes" | "maybe" | "no"; comment?: string } | { kind: "cancel"; comment?: string } | { kind: "restore" } | { kind: "delete" },
): Promise<void> {
  const base = `${cal(accountId, calendarId)}/events/${encodeURIComponent(eventId)}`;
  if (action.kind === "delete") await request(base, { method: "DELETE" });
  else if (action.kind === "rsvp") await request(`${base}/rsvp`, { method: "POST", body: { status: action.status, ...(action.comment ? { comment: action.comment } : {}) } });
  else if (action.kind === "cancel") await request(`${base}/cancel`, { method: "POST", body: action.comment ? { comment: action.comment } : {} });
  else await request(`${base}/restore`, { method: "POST", body: {} });
}

import "server-only";
import { normalizePhone } from "@/lib/contact-normalize";
import { localDateTimeToUtc } from "@/lib/timezone";
import { UnipileError, rateLimitError } from "./unipile";

// WhatsApp POC, stage 2 (1.11.2026): call recordings from the Aloha line.
//
// Aloha (the line runs on פרי טלקום's network) sends one email per call to
// aloha@ankora.co.il, from donotreply@aloha.global:
//   Subject: Call Recording [972524435305 => 972553302266]
//   Body:    From: 972524435305 / To: 972553302266 / Date: 29/10/2026 14:53:07
//   One audio/mpeg attachment, named after the call's start in Unix seconds.
// The date is Israel wall-clock time; the email itself arrives when the
// call ends. The mailbox is connected to Unipile, so it is read through the
// same API and key as the WhatsApp screen.
//
// Nothing is stored. The list is read live, the audio is streamed through
// our own route, and a transcript is shown once and not kept.

export const RECORDING_SENDER = "donotreply@aloha.global";
const BASE_URL = "https://api.unipile.com/v2";
const TIMEOUT_MS = 20_000;

export type ParsedRecording = {
  from: string;
  to: string;
  /// UTC instant of the call's start.
  callAt: string;
};

/// "972524435305" as Aloha writes it, in E.164.
function e164(digits: string): string | null {
  const phone = normalizePhone(`+${digits}`);
  return phone && /^\+\d{8,15}$/.test(phone) ? phone : null;
}

/// The numbers and the time of the call, from the email's plain body (or,
/// for the numbers, its subject). Null when it is not a recording email.
export function parseRecordingEmail(subject: string, bodyPlain: string): ParsedRecording | null {
  const fromBody = /From:\s*(\d{8,15})/i.exec(bodyPlain)?.[1];
  const toBody = /To:\s*(\d{8,15})/i.exec(bodyPlain)?.[1];
  const subjectMatch = /\[(\d{8,15})\s*=>\s*(\d{8,15})\]/.exec(subject);
  const from = e164(fromBody ?? subjectMatch?.[1] ?? "");
  const to = e164(toBody ?? subjectMatch?.[2] ?? "");
  const date = /Date:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(bodyPlain);
  if (!from || !to || !date) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = date;
  const utc = localDateTimeToUtc(`${yyyy}-${mm}-${dd}`, `${hh}:${mi}`);
  if (Number.isNaN(utc.getTime())) return null;
  return { from, to, callAt: new Date(utc.getTime() + Number(ss) * 1000).toISOString() };
}

/// The other side of the call, and which way it went, seen from our line.
/// With no line configured, or a call that does not touch it, the
/// direction is unknown and both numbers stay visible.
export function callSide(rec: ParsedRecording, line: string | null): { direction: "in" | "out" | "unknown"; other: string } {
  if (line && rec.to === line) return { direction: "in", other: rec.from };
  if (line && rec.from === line) return { direction: "out", other: rec.to };
  return { direction: "unknown", other: rec.from };
}

export type Recording = ParsedRecording & {
  emailId: string;
  attachmentId: string;
  sizeBytes: number | null;
};

type RawEmail = {
  id?: unknown;
  subject?: unknown;
  body_plain?: unknown;
  attachments?: Array<{ id?: unknown; mimetype?: unknown; is_inline?: unknown; file_size?: unknown }> | null;
};

export function toRecording(raw: RawEmail): Recording | null {
  if (typeof raw.id !== "string" || !raw.id) return null;
  const parsed = parseRecordingEmail(
    typeof raw.subject === "string" ? raw.subject : "",
    typeof raw.body_plain === "string" ? raw.body_plain : "",
  );
  if (!parsed) return null;
  const audio = (raw.attachments ?? []).find(
    (a) => typeof a.id === "string" && typeof a.mimetype === "string" && a.mimetype.startsWith("audio/") && a.is_inline !== true,
  );
  if (!audio || typeof audio.id !== "string") return null;
  return {
    ...parsed,
    emailId: raw.id,
    attachmentId: audio.id,
    sizeBytes: typeof audio.file_size === "number" ? audio.file_size : null,
  };
}

async function unipileFetch(apiKey: string, url: URL, accept: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "X-API-KEY": apiKey, accept },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new UnipileError("Unipile לא ענה.", null);
  }
  if (response.status === 429) throw await rateLimitError(response);
  if (!response.ok) throw new UnipileError(`Unipile החזיר שגיאה ${response.status}.`, response.status);
  return response;
}

/// The latest recordings, newest first. Emails that do not parse are
/// skipped, so a stray message from the same sender cannot break the list.
export async function listRecordings(
  config: { apiKey: string; mailAccountId: string },
  limit = 25,
): Promise<Recording[]> {
  const url = new URL(`${BASE_URL}/${config.mailAccountId}/emails`);
  url.searchParams.set("from", RECORDING_SENDER);
  url.searchParams.set("limit", String(limit));
  const response = await unipileFetch(config.apiKey, url, "application/json");
  const body = (await response.json()) as { data?: unknown };
  const data = Array.isArray(body.data) ? body.data : [];
  return data.map((e) => toRecording(e as RawEmail)).filter((r): r is Recording => r !== null);
}

/// Ids as Unipile hands them out for Gmail: letters, digits, "-" and "_".
export function isSafeId(id: string): boolean {
  return id.length > 0 && id.length <= 1000 && /^[A-Za-z0-9_-]+$/.test(id);
}

/// One recording's audio, by email id alone. The email is read first and
/// must be a recording email from Aloha; its audio attachment is the only
/// file that can come back, so this cannot pull anything else out of the
/// mailbox.
///
/// 1.11.2026: the attachment is found again on every request rather than
/// taken from the list. Gmail issues a new attachment id each time an
/// email is read, so the id the list had shown was already stale when the
/// player asked for it, and every recording answered 404.
export async function fetchRecordingAudio(
  config: { apiKey: string; mailAccountId: string },
  emailId: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!isSafeId(emailId)) return null;
  const emailUrl = new URL(`${BASE_URL}/${config.mailAccountId}/emails/${emailId}`);
  const email = (await (await unipileFetch(config.apiKey, emailUrl, "application/json")).json()) as RawEmail & {
    from?: Array<{ email?: unknown }>;
  };
  const sender = email.from?.[0]?.email;
  const rec = toRecording(email);
  if (sender !== RECORDING_SENDER || !rec || !isSafeId(rec.attachmentId)) return null;
  const fileUrl = new URL(`${BASE_URL}/${config.mailAccountId}/emails/${emailId}/attachments/${rec.attachmentId}`);
  const file = await unipileFetch(config.apiKey, fileUrl, "*/*");
  const contentType = file.headers.get("content-type") ?? "audio/mpeg";
  return { bytes: await file.arrayBuffer(), contentType: contentType.startsWith("audio/") ? contentType : "audio/mpeg" };
}

// 1.11.2026 (communications screen): the recordings now load with every
// view of the screen, next to the chat list, and Unipile counts requests
// per route against a quota (see unipile.ts). So the list is kept in this
// instance's memory for five minutes, and if a read fails (a 429 above
// all) a list up to two hours old is shown instead of nothing. Like the
// chat list, it holds only what the screen shows and is never written
// anywhere.
export const RECORDINGS_FRESH_MS = 5 * 60_000;
export const RECORDINGS_MAX_AGE_MS = 2 * 60 * 60_000;
let cachedRecordings: { accountId: string; at: number; recordings: Recording[] } | null = null;

/// For tests: forget the remembered list.
export function resetRecordingsCache(): void {
  cachedRecordings = null;
}

export async function listRecordingsCached(
  config: { apiKey: string; mailAccountId: string },
  read: (config: { apiKey: string; mailAccountId: string }) => Promise<Recording[]> = (c) => listRecordings(c),
  now: () => number = Date.now,
): Promise<{ recordings: Recording[]; stale: boolean }> {
  const cached = cachedRecordings && cachedRecordings.accountId === config.mailAccountId ? cachedRecordings : null;
  const age = cached ? now() - cached.at : Infinity;
  if (cached && age < RECORDINGS_FRESH_MS) return { recordings: cached.recordings, stale: false };
  try {
    const recordings = await read(config);
    cachedRecordings = { accountId: config.mailAccountId, at: now(), recordings };
    return { recordings, stale: false };
  } catch (err) {
    if (cached && age < RECORDINGS_MAX_AGE_MS) return { recordings: cached.recordings, stale: true };
    throw err;
  }
}

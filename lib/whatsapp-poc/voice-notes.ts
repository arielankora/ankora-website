import "server-only";
import { UnipileError, toPocMessage } from "./unipile";

// WhatsApp POC (1.11.2026): a WhatsApp voice message's audio, for the
// player and the transcribe button in the chat view.
//
// Unipile returns a voice message as an audio attachment (audio/ogg,
// Opus) whose id is the message id, so unlike Gmail's attachments it does
// not change between reads. Even so, the message is read first and the
// file is taken from it: only an audio attachment of that message can come
// back, never another file from the account.

const BASE_URL = "https://api.unipile.com/v2";
const TIMEOUT_MS = 20_000;
/// Voice messages are small; this keeps a mislabelled large file out.
const MAX_BYTES = 25 * 1024 * 1024;

/// WhatsApp chat ids ("236739352334449@lid", "1203...@g.us") and message
/// ids (hex) as Unipile hands them out. Nothing that could change the path.
export function isSafeChatId(id: string): boolean {
  return id.length > 0 && id.length <= 200 && /^[A-Za-z0-9._-]+@[A-Za-z0-9.]+$/.test(id);
}

export function isSafeMessageId(id: string): boolean {
  return id.length > 0 && id.length <= 200 && /^[A-Za-z0-9_-]+$/.test(id);
}

async function get(apiKey: string, url: string, accept: string): Promise<Response> {
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
  if (response.status === 429) throw new UnipileError("Unipile מגביל כרגע את קצב הבקשות. נסו שוב בעוד דקה.", 429);
  if (!response.ok) throw new UnipileError(`Unipile החזיר שגיאה ${response.status}.`, response.status);
  return response;
}

export async function fetchVoiceNote(
  config: { apiKey: string; accountId: string },
  chatId: string,
  messageId: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!isSafeChatId(chatId) || !isSafeMessageId(messageId)) return null;
  const messageUrl = `${BASE_URL}/${config.accountId}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`;
  const message = toPocMessage(await (await get(config.apiKey, messageUrl, "application/json")).json());
  const audio = message?.attachments.find((a) => a.id && a.type === "audio");
  if (!message || !audio?.id || !isSafeMessageId(audio.id)) return null;
  const file = await get(config.apiKey, `${messageUrl}/attachments/${encodeURIComponent(audio.id)}`, "*/*");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return null;
  const header = file.headers.get("content-type") ?? "";
  const contentType = header.startsWith("audio/") ? header : (audio.mimetype ?? "audio/ogg");
  return { bytes, contentType };
}

import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { Forbidden } from "@/components/app/Forbidden";
import { canSendTo, canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { normalizePhone } from "@/lib/contact-normalize";
import {
  UnipileError,
  CHAT_PAGE_SIZE,
  findChatByPhone,
  getChat,
  isConfigured,
  isHiddenChat,
  listChats,
  parseOffset,
  listMessages,
  readPocConfig,
  type PocChat,
  type PocMessage,
} from "@/lib/whatsapp-poc/unipile";
import { SendForm } from "./SendForm";
import { RecordingPlayer } from "./calls/RecordingPlayer";
import { TranscribeButton } from "./calls/TranscribeButton";

// WhatsApp POC, stage 1 (31.10.2026): a manager reads the chats of one
// WhatsApp number live from Unipile and can answer a test number. Nothing
// is stored here. See lib/whatsapp-poc/access.ts for who may see and who
// may be written to.

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function formatDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(date);
}

const ATTACHMENT_LABEL: Record<string, string> = {
  img: "תמונה",
  image: "תמונה",
  video: "וידאו",
  audio: "הודעה קולית",
  file: "קובץ",
  sticker: "מדבקה",
};

function attachmentLabel(a: PocMessage["attachments"][number]) {
  if (a.voiceNote) return "הודעה קולית";
  return ATTACHMENT_LABEL[a.type] ?? "קובץ";
}

function mediaHref(chatId: string, messageId: string, attachmentId: string) {
  return `/api/whatsapp-poc/media/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}`;
}

function pageHref(params: { chat?: string; offset?: number }) {
  const q = new URLSearchParams();
  if (params.chat) q.set("chat", params.chat);
  if (params.offset) q.set("offset", String(params.offset));
  const s = q.toString();
  return s ? `/app/whatsapp-poc?${s}` : "/app/whatsapp-poc";
}

export default async function WhatsappPocPage(props: { searchParams: Promise<{ chat?: string; offset?: string; phone?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const config = readPocConfig();

  if (!canViewWhatsappPoc(user, config.viewers)) {
    return <Forbidden />;
  }

  if (!isConfigured(config)) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-medium text-app-text-primary">WhatsApp: בדיקה</h1>
        <p className="text-sm text-app-text-secondary">
          ה-POC לא מוגדר בסביבה הזו. חסרים UNIPILE_API_KEY או UNIPILE_WHATSAPP_ACCOUNT_ID.
        </p>
      </div>
    );
  }

  const offset = parseOffset(searchParams.offset);
  let chats: PocChat[] = [];
  let hasMore = false;
  let loadError: string | null = null;
  try {
    ({ chats, hasMore } = await listChats(config, { offset }));
  } catch (err) {
    if (!(err instanceof UnipileError)) throw err;
    loadError = err.message;
  }

  // A chat that is not on the page of the list being shown (an older one,
  // or a link kept from before) is read on its own.
  const requestedId = searchParams.chat && searchParams.chat.length <= 200 ? searchParams.chat : null;
  let selected: PocChat | null = chats.find((c) => c.id === requestedId) ?? null;
  let phoneNotFound = false;
  if (!selected && !requestedId && searchParams.phone) {
    const phone = normalizePhone(searchParams.phone.slice(0, 40));
    try {
      selected = phone ? await findChatByPhone(config, phone) : null;
      phoneNotFound = selected === null;
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      loadError = err.message;
    }
  }
  if (!selected && requestedId) {
    try {
      const chat = await getChat(config, requestedId);
      selected = chat && !isHiddenChat(chat) ? chat : null;
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      loadError = err.message;
    }
  }
  let messages: PocMessage[] = [];
  if (selected) {
    try {
      messages = await listMessages(config, selected.id);
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      loadError = err.message;
    }
  }
  const mayReply = selected !== null && selected.type === "1to1" && canSendTo(selected.phone, config.sendTo);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">WhatsApp: בדיקה</h1>
        <p className="mt-1 text-sm text-app-text-secondary">
          נקרא בזמן אמת מ-Unipile ולא נשמר במערכת. שליחה רק למספרי הבדיקה.
        </p>
        <Link href="/app/whatsapp-poc/calls" className="mt-1 inline-flex min-h-11 items-center text-sm text-app-text-primary underline">
          הקלטות שיחה
        </Link>
      </div>

      {loadError ? (
        <p role="alert" className="rounded-lg bg-app-error-soft p-3 text-sm text-app-error">
          {loadError}
        </p>
      ) : null}

      <form method="get" action="/app/whatsapp-poc" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="poc-phone" className="block text-xs font-medium text-app-text-secondary">
            פתיחת שיחה לפי מספר
          </label>
          <input
            id="poc-phone"
            name="phone"
            type="tel"
            dir="ltr"
            defaultValue={searchParams.phone ?? ""}
            placeholder="055-1234567"
            className="mt-1.5 rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </div>
        <button type="submit" className="min-h-11 rounded-lg border border-app-border-strong px-4 text-sm text-app-text-primary">
          פתיחה
        </button>
        {phoneNotFound ? <p className="text-sm text-app-text-secondary">לא נמצאה שיחה עם המספר הזה.</p> : null}
      </form>

      <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <nav aria-label="שיחות" className="overflow-hidden rounded-2xl border border-app-border bg-white">
          <ul className="max-h-[70vh] divide-y divide-app-border overflow-y-auto">
            {chats.map((chat) => (
              <li key={chat.id}>
                <Link
                  href={pageHref({ chat: chat.id, offset })}
                  aria-current={selected?.id === chat.id ? "page" : undefined}
                  className={`block px-4 py-3 text-sm hover:bg-app-surface-sunken ${selected?.id === chat.id ? "bg-app-surface-sunken" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-app-text-primary">{chat.name}</span>
                    {chat.unreadCount > 0 ? (
                      <span className="rounded-full bg-gold px-2 text-xs text-white">{chat.unreadCount}</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-app-text-secondary">
                    {chat.type === "group" ? "קבוצה · " : ""}
                    {chat.lastMessagePreview ?? ""}
                  </span>
                  <span className="mt-0.5 block text-xs text-app-text-secondary">{formatDateTime(chat.lastMessageAt)}</span>
                </Link>
              </li>
            ))}
            {chats.length === 0 && !loadError ? (
              <li className="px-4 py-3 text-sm text-app-text-secondary">אין שיחות.</li>
            ) : null}
          </ul>
          {hasMore || offset > 0 ? (
            <div className="flex flex-wrap gap-4 border-t border-app-border px-4 py-3 text-sm">
              {offset > 0 ? (
                <Link href={pageHref({ offset: offset - CHAT_PAGE_SIZE })} className="inline-flex min-h-11 items-center text-app-text-primary underline">
                  שיחות חדשות יותר
                </Link>
              ) : null}
              {hasMore ? (
                <Link
                  href={pageHref({ offset: offset + CHAT_PAGE_SIZE })}
                  className="inline-flex min-h-11 items-center text-app-text-primary underline"
                >
                  שיחות ישנות יותר
                </Link>
              ) : null}
            </div>
          ) : null}
        </nav>

        <section aria-label="הודעות" className="flex min-h-[20rem] flex-col rounded-2xl border border-app-border bg-white">
          {selected ? (
            <>
              <header className="border-b border-app-border px-4 py-3">
                <h2 className="text-base font-medium text-app-text-primary">{selected.name}</h2>
                {selected.phone ? (
                  <p dir="ltr" className="text-end text-xs text-app-text-secondary">
                    {selected.phone}
                  </p>
                ) : null}
              </header>
              <ol className="flex-1 space-y-2 overflow-y-auto p-4">
                {messages.map((m) => (
                  <li key={m.id} className={`flex ${m.isSender ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${m.isSender ? "bg-app-surface-sunken" : "border border-app-border"}`}
                    >
                      {!m.isSender && selected.type === "group" && m.senderName ? (
                        <p className="text-xs font-medium text-app-text-secondary">{m.senderName}</p>
                      ) : null}
                      {m.isDeleted ? (
                        <p className="italic text-app-text-secondary">ההודעה נמחקה</p>
                      ) : !m.text && m.attachments.length === 0 ? (
                        // Unipile returns some WhatsApp kinds (a poll, a
                        // location, a contact card, some stickers) with
                        // neither text nor an attachment.
                        <p className="italic text-app-text-secondary">[הודעה שאינה טקסט, לא מוצגת כאן]</p>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-app-text-primary">{m.text}</p>
                      )}
                      {m.attachments.map((a, i) =>
                        a.type === "audio" && a.id ? (
                          // A voice message (or any audio): played and, when
                          // a transcription key is set, transcribed here.
                          <div key={i} className="mt-1 min-w-64 space-y-2">
                            <p className="text-xs text-app-text-secondary">
                              {attachmentLabel(a)}
                              {a.duration ? ` · ${Math.floor(a.duration / 60)}:${String(Math.round(a.duration % 60)).padStart(2, "0")}` : ""}
                            </p>
                            <RecordingPlayer
                              src={`/api/whatsapp-poc/voice/${encodeURIComponent(selected.id)}/${encodeURIComponent(m.id)}`}
                            />
                            {config.hasOpenAiKey ? (
                              <TranscribeButton kind="voice" chatId={selected.id} messageId={m.id} />
                            ) : null}
                          </div>
                        ) : a.id && (a.type === "img" || a.type === "image") ? (
                          // 1.11.2026: images shown in the bubble, through the
                          // same gated route as every other attachment.
                          <a
                            key={i}
                            href={mediaHref(selected.id, m.id, a.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 block"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- a private, per-request file; next/image would cache it */}
                            <img
                              src={mediaHref(selected.id, m.id, a.id)}
                              alt={attachmentLabel(a)}
                              loading="lazy"
                              className="max-h-72 max-w-full rounded-lg"
                            />
                          </a>
                        ) : a.id && a.type === "video" ? (
                          <video
                            key={i}
                            controls
                            preload="none"
                            className="mt-1 max-h-72 max-w-full rounded-lg"
                            src={mediaHref(selected.id, m.id, a.id)}
                          />
                        ) : a.id ? (
                          <a
                            key={i}
                            href={mediaHref(selected.id, m.id, a.id)}
                            className="mt-1 inline-flex min-h-11 items-center text-xs text-app-text-primary underline"
                          >
                            הורדת {attachmentLabel(a)}
                          </a>
                        ) : (
                          <p key={i} className="text-xs text-app-text-secondary">
                            [{attachmentLabel(a)}]
                          </p>
                        ),
                      )}
                      <p className="mt-1 text-xs text-app-text-secondary">
                        {m.isSender ? "את/ה · " : ""}
                        {formatDateTime(m.timestamp)}
                      </p>
                    </div>
                  </li>
                ))}
                {messages.length === 0 && !loadError ? (
                  <li className="text-sm text-app-text-secondary">אין הודעות להצגה.</li>
                ) : null}
              </ol>
              {mayReply ? (
                <SendForm chatId={selected.id} />
              ) : (
                <p className="border-t border-app-border p-4 text-xs text-app-text-secondary">
                  שליחה מכאן אפשרית רק לשיחה אישית עם מספר שברשימת הבדיקה.
                </p>
              )}
            </>
          ) : (
            <p className="p-4 text-sm text-app-text-secondary">בחרו שיחה מהרשימה.</p>
          )}
        </section>
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { Forbidden } from "@/components/app/Forbidden";
import { canSendTo, canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import {
  UnipileError,
  cleanCursor,
  getChat,
  isConfigured,
  isHiddenChat,
  listChats,
  listMessages,
  readPocConfig,
  type PocChat,
  type PocMessage,
} from "@/lib/whatsapp-poc/unipile";
import { SendForm } from "./SendForm";

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

function chatHref(chatId: string, cursor: string | null) {
  const params = new URLSearchParams({ chat: chatId });
  if (cursor) params.set("cursor", cursor);
  return `/app/whatsapp-poc?${params.toString()}`;
}

export default async function WhatsappPocPage(props: { searchParams: Promise<{ chat?: string; cursor?: string }> }) {
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

  const cursor = cleanCursor(searchParams.cursor);
  let chats: PocChat[] = [];
  let nextCursor: string | null = null;
  let loadError: string | null = null;
  try {
    ({ chats, nextCursor } = await listChats(config, { cursor }));
  } catch (err) {
    if (!(err instanceof UnipileError)) throw err;
    loadError = err.message;
  }

  // A chat that is not on the page of the list being shown (an older one,
  // or a link kept from before) is read on its own.
  const requestedId = searchParams.chat && searchParams.chat.length <= 200 ? searchParams.chat : null;
  let selected: PocChat | null = chats.find((c) => c.id === requestedId) ?? null;
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
      </div>

      {loadError ? (
        <p role="alert" className="rounded-lg bg-app-error-soft p-3 text-sm text-app-error">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <nav aria-label="שיחות" className="overflow-hidden rounded-2xl border border-app-border bg-white">
          <ul className="max-h-[70vh] divide-y divide-app-border overflow-y-auto">
            {chats.map((chat) => (
              <li key={chat.id}>
                <Link
                  href={chatHref(chat.id, cursor)}
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
          {nextCursor || cursor ? (
            <div className="flex flex-wrap gap-4 border-t border-app-border px-4 py-3 text-sm">
              {cursor ? (
                <Link href="/app/whatsapp-poc" className="inline-flex min-h-11 items-center text-app-text-primary underline">
                  לשיחות האחרונות
                </Link>
              ) : null}
              {nextCursor ? (
                <Link
                  href={`/app/whatsapp-poc?${new URLSearchParams({ cursor: nextCursor }).toString()}`}
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
                      {m.attachments.map((a, i) => (
                        <p key={i} className="text-xs text-app-text-secondary">
                          [{attachmentLabel(a)}]
                        </p>
                      ))}
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

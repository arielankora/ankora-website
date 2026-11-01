import Link from "next/link";
import { ArrowRight, MessageCircle, Phone } from "lucide-react";
import { requireUser } from "@/lib/app-auth/session";
import { Forbidden } from "@/components/app/Forbidden";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { canSendTo, canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { matchPhones, type PhoneMatch } from "@/lib/whatsapp-poc/clients-by-phone";
import { normalizePhone } from "@/lib/contact-normalize";
import {
  INBOX_FILTERS,
  buildInbox,
  buildTimeline,
  chatPhone,
  countSince,
  dayKey,
  filterInbox,
  formatDuration,
  parseFilter,
  parseKey,
  phoneKey,
  chatKey,
  proposeTask,
  type InboxCall,
  type InboxFilter,
  type InboxRow,
} from "@/lib/whatsapp-poc/inbox";
import { callSide, listRecordingsCached, type Recording } from "@/lib/whatsapp-poc/recordings";
import {
  UnipileError,
  findChatByPhone,
  getChat,
  isConfigured,
  isHiddenChat,
  listMessages,
  loadMergedChats,
  readPocConfig,
  type PocChat,
  type PocMessage,
} from "@/lib/whatsapp-poc/unipile";
import { SendForm } from "./SendForm";
import { AddNumberForm, AssignToClientForm } from "./ContactForms";
import { TaskFromConversation } from "./TaskFromConversation";
import { RecordingPlayer } from "./calls/RecordingPlayer";
import { TranscribeButton } from "./calls/TranscribeButton";

// Communications screen (1.11.2026, from Ariel's review of the design on
// Claude Design): WhatsApp and the Aloha line's call recordings in one
// place. One list, one row per person; one timeline per person mixing
// messages, voice messages and calls; the person's client file beside it.
// The recordings used to be a separate page behind a link
// (/app/whatsapp-poc/calls, which now redirects here).
//
// Still a POC: everything is read live from Unipile and nothing from the
// conversations is stored, except what a person chooses to save (a task,
// or a number in a client's file). Sending stays limited to the test
// numbers. See lib/whatsapp-poc/inbox.ts for how the two sources are put
// together.

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const BASE = "/app/whatsapp-poc";
const DAY_MS = 24 * 60 * 60 * 1000;

function href(params: { c?: string | null; filter?: InboxFilter; q?: string; wa?: boolean }) {
  const q = new URLSearchParams();
  if (params.filter && params.filter !== "all") q.set("filter", params.filter);
  if (params.q) q.set("q", params.q);
  if (params.c) q.set("c", params.c);
  if (params.wa) q.set("wa", "1");
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}

function formatListTime(iso: string | null, now: Date) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (dayKey(iso) === dayKey(now.toISOString())) return formatTime(iso);
  if (dayKey(iso) === dayKey(new Date(now.getTime() - DAY_MS).toISOString())) return "אתמול";
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
}

function formatDay(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" }).format(
    new Date(iso),
  );
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const DIRECTION_LABEL = { in: "שיחה נכנסת", out: "שיחה יוצאת", unknown: "שיחה" } as const;
const DIRECTION_SHORT = { in: "נכנסת", out: "יוצאת", unknown: "" } as const;

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

function recordingHref(emailId: string) {
  return `/api/whatsapp-poc/recordings/${encodeURIComponent(emailId)}`;
}

function ChannelIcon({ channel }: { channel: "wa" | "call" }) {
  return channel === "wa" ? (
    <span aria-hidden="true" className="flex size-9 flex-none items-center justify-center rounded-full bg-app-success-soft text-app-success">
      <MessageCircle className="size-[18px]" />
    </span>
  ) : (
    <span aria-hidden="true" className="flex size-9 flex-none items-center justify-center rounded-full bg-app-info-soft text-app-info">
      <Phone className="size-[18px]" />
    </span>
  );
}

function ClientTag({ clients }: { clients: Array<{ id: string; name: string }> }) {
  if (clients.length === 0) {
    return <span className="self-start rounded-full bg-app-warning-soft px-2 py-0.5 text-xs text-app-warning">לא משויך ללקוח</span>;
  }
  return (
    <span className="self-start truncate rounded-full bg-app-accent-soft px-2 py-0.5 text-xs text-app-text-accent">
      {clients.map((c) => c.name).join(", ")}
    </span>
  );
}

function Banner({ tone, children }: { tone: "error" | "warning" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "bg-app-error-soft text-app-error"
      : tone === "warning"
        ? "bg-app-warning-soft text-app-text-primary"
        : "bg-app-surface-sunken text-app-text-secondary";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${cls}`}>
      {children}
    </p>
  );
}

function MessageBubble({ m, chat }: { m: PocMessage; chat: PocChat }) {
  const mine = m.isSender;
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] space-y-1 px-3.5 py-2.5 text-[15px] sm:max-w-[65%] ${
          mine ? "rounded-2xl rounded-ee-md bg-navy text-white" : "rounded-2xl rounded-es-md border border-app-border bg-white text-app-text-primary"
        }`}
      >
        {!mine && chat.type === "group" && m.senderName ? <p className="text-xs font-medium text-app-text-secondary">{m.senderName}</p> : null}
        {m.isDeleted ? (
          <p className={`italic ${mine ? "text-white/70" : "text-app-text-secondary"}`}>ההודעה נמחקה</p>
        ) : !m.text && m.attachments.length === 0 ? (
          // Unipile returns some WhatsApp kinds (a poll, a location, a
          // contact card, some stickers) with neither text nor attachment.
          <p className={`italic ${mine ? "text-white/70" : "text-app-text-secondary"}`}>[הודעה שאינה טקסט, לא מוצגת כאן]</p>
        ) : m.text ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>
        ) : null}
        {m.attachments.map((a, i) =>
          a.type === "audio" && a.id ? (
            <div key={i} className="min-w-64 space-y-2 rounded-xl bg-white p-2 text-app-text-primary">
              <p className="text-xs text-app-text-secondary">
                {attachmentLabel(a)}
                {a.duration ? ` · ${formatDuration(a.duration)}` : ""}
              </p>
              <RecordingPlayer src={`/api/whatsapp-poc/voice/${encodeURIComponent(chat.id)}/${encodeURIComponent(m.id)}`} />
              <TranscribeButton kind="voice" chatId={chat.id} messageId={m.id} />
            </div>
          ) : a.id && (a.type === "img" || a.type === "image") ? (
            <a key={i} href={mediaHref(chat.id, m.id, a.id)} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- a private, per-request file; next/image would cache it */}
              <img src={mediaHref(chat.id, m.id, a.id)} alt={attachmentLabel(a)} loading="lazy" className="max-h-72 max-w-full rounded-lg" />
            </a>
          ) : a.id && a.type === "video" ? (
            <video key={i} controls preload="none" className="max-h-72 max-w-full rounded-lg" src={mediaHref(chat.id, m.id, a.id)} />
          ) : a.id ? (
            <a key={i} href={mediaHref(chat.id, m.id, a.id)} className="inline-flex min-h-11 items-center text-xs underline">
              הורדת {attachmentLabel(a)}
            </a>
          ) : (
            <p key={i} className="text-xs opacity-80">
              [{attachmentLabel(a)}]
            </p>
          ),
        )}
        <p className={`text-[11px] ${mine ? "text-white/75" : "text-app-text-secondary"}`}>
          {formatTime(m.timestamp)}
          {mine ? " · נשלח" : ""}
        </p>
      </div>
    </li>
  );
}

function CallCard({ call, transcribe }: { call: InboxCall & { sizeBytes: number | null }; transcribe: boolean }) {
  return (
    <li className="space-y-3 rounded-xl border border-app-info-soft bg-white p-4 ring-1 ring-app-border">
      <div className="flex items-center gap-3">
        <ChannelIcon channel="call" />
        <div>
          <p className="text-[15px] font-medium text-app-text-primary">{DIRECTION_LABEL[call.direction]}</p>
          <p className="text-xs text-app-text-secondary">
            {formatTime(call.callAt)} · הקו של אנקורה{call.sizeBytes ? ` · ${formatSize(call.sizeBytes)}` : ""}
          </p>
        </div>
      </div>
      <RecordingPlayer src={recordingHref(call.emailId)} />
      {transcribe ? <TranscribeButton kind="recording" emailId={call.emailId} /> : null}
    </li>
  );
}

export default async function CommunicationsPage(props: {
  searchParams: Promise<{ c?: string; filter?: string; q?: string; phone?: string; wa?: string; chat?: string }>;
}) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const config = readPocConfig();
  if (!canViewWhatsappPoc(user, config.viewers)) return <Forbidden />;

  const filter = parseFilter(searchParams.filter);
  const query = (searchParams.q ?? "").slice(0, 80);
  const now = new Date();

  const waConfig = isConfigured(config) ? config : null;
  const waReady = waConfig !== null;
  const mailConfig = config.apiKey && config.mailAccountId ? { apiKey: config.apiKey, mailAccountId: config.mailAccountId } : null;
  const callsReady = mailConfig !== null;
  if (!waReady && !callsReady) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-medium text-app-text-primary">תקשורת עם לקוחות</h1>
        <p className="text-sm text-app-text-secondary">המסך לא מוגדר בסביבה הזו. חסרים UNIPILE_API_KEY ומזהי החשבונות.</p>
      </div>
    );
  }

  // The two sources, each on its own: one failing leaves the other.
  let chats: PocChat[] = [];
  let waError: string | null = null;
  if (waConfig) {
    try {
      chats = (await loadMergedChats(waConfig)).chats;
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      waError = err.message;
    }
  }
  let recordings: Recording[] = [];
  let callsError: string | null = null;
  let callsStale = false;
  if (mailConfig) {
    try {
      ({ recordings, stale: callsStale } = await listRecordingsCached(mailConfig));
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      callsError = err.message;
    }
  }
  const calls: Array<InboxCall & { sizeBytes: number | null }> = recordings.map((r) => {
    const side = callSide(r, config.lineNumber);
    return { emailId: r.emailId, callAt: r.callAt, direction: side.direction, other: side.other, sizeBytes: r.sizeBytes };
  });

  // Which contact is open: from the list (?c=), an old link (?chat=), or
  // the "open by number" box (?phone=).
  let selectedKey = parseKey(searchParams.c);
  if (!selectedKey && searchParams.chat && searchParams.chat.length <= 200) selectedKey = { chatId: searchParams.chat };
  const typedPhone = searchParams.phone ? normalizePhone(searchParams.phone.slice(0, 40)) : null;
  const phoneFromBox = typedPhone && /^\+\d{8,15}$/.test(typedPhone) ? typedPhone : null;
  if (phoneFromBox) selectedKey = { phone: phoneFromBox };
  const badPhone = Boolean(searchParams.phone) && !phoneFromBox;

  // The chat of the open contact. A number with no chat in the list is
  // looked up at Unipile only when asked (the box, or the "find" link),
  // because every lookup counts against the quota.
  let chat: PocChat | null = null;
  let selectedPhone: string | null = null;
  let lookedUp = false;
  if (selectedKey && "phone" in selectedKey) {
    selectedPhone = selectedKey.phone;
    chat = chats.find((c) => chatPhone(c) === selectedPhone) ?? null;
    if (!chat && waConfig && (phoneFromBox || searchParams.wa === "1")) {
      lookedUp = true;
      try {
        chat = await findChatByPhone(waConfig, selectedPhone);
      } catch (err) {
        if (!(err instanceof UnipileError)) throw err;
        waError = err.message;
      }
    }
  } else if (selectedKey && "chatId" in selectedKey) {
    const id = selectedKey.chatId;
    chat = chats.find((c) => c.id === id) ?? null;
    if (!chat && waConfig) {
      try {
        const found = await getChat(waConfig, id);
        chat = found && !isHiddenChat(found) ? found : null;
      } catch (err) {
        if (!(err instanceof UnipileError)) throw err;
        waError = err.message;
      }
    }
    selectedPhone = chat ? chatPhone(chat) : null;
  }

  let messages: PocMessage[] = [];
  if (chat && waConfig) {
    try {
      messages = await listMessages(waConfig, chat.id);
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      waError = err.message;
    }
  }

  const owners = await matchPhones([
    ...chats.map((c) => chatPhone(c)).filter((p): p is string => Boolean(p)),
    ...calls.map((c) => c.other),
    ...(selectedPhone ? [selectedPhone] : []),
  ]);
  const rows = buildInbox(chats, calls, owners);
  const visible = filterInbox(rows, filter, query);

  const isOpen = Boolean(selectedKey) && (Boolean(chat) || Boolean(selectedPhone));
  const openKey = selectedPhone ? phoneKey(selectedPhone) : chat ? chatKey(chat.id) : null;
  const openRow: InboxRow | undefined = rows.find((r) => r.key === openKey);
  const owner: PhoneMatch | undefined = selectedPhone ? owners.get(selectedPhone) : undefined;
  const contactCalls = selectedPhone ? calls.filter((c) => c.other === selectedPhone) : [];
  const timeline = buildTimeline(messages, contactCalls);
  const messageById = new Map(messages.map((m) => [m.id, m]));
  const callById = new Map(contactCalls.map((c) => [c.emailId, c]));
  const contactName = owner?.personName ?? openRow?.name ?? chat?.name ?? selectedPhone ?? "";
  const mayReply = chat !== null && chat.type === "1to1" && canSendTo(chat.phone, config.sendTo);

  const accessible = isOpen || filter === "call" ? await listAccessibleClients(user) : [];
  const clientOptions = accessible.map((c) => ({ id: c.id, name: c.name }));
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const proposal = proposeTask({
    name: contactName,
    phone: selectedPhone,
    lastMessages: messages.map((m) => ({ text: m.text, isSender: m.isSender })),
    lastCall: contactCalls[0] ? { at: contactCalls[0].callAt, direction: contactCalls[0].direction } : null,
  });

  const callsTable = filter === "call" && !isOpen;

  const chips = (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="סינון">
      {INBOX_FILTERS.map((f) => (
        <Link
          key={f.id}
          href={href({ filter: f.id, q: query, c: callsTable || f.id === "call" ? null : openKey })}
          aria-current={filter === f.id ? "page" : undefined}
          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-[13px] ${
            filter === f.id ? "border-navy bg-navy font-medium text-white" : "border-app-border-strong bg-white text-app-text-secondary"
          }`}
        >
          {f.label}
        </Link>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">תקשורת עם לקוחות</h1>
          <p className="mt-0.5 text-sm text-app-text-secondary">WhatsApp ושיחות טלפון במקום אחד. בדיקה: נקרא בזמן אמת ולא נשמר במערכת.</p>
        </div>
        <form method="get" action={BASE} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="open-phone" className="block text-xs font-medium text-app-text-secondary">
              פתיחה לפי מספר
            </label>
            <input
              id="open-phone"
              name="phone"
              type="tel"
              dir="ltr"
              defaultValue={searchParams.phone ?? ""}
              placeholder="050-0000000"
              className="mt-1 w-44 rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </div>
          <button type="submit" className="min-h-10 rounded-lg bg-navy px-4 text-sm font-medium text-white">
            פתיחה
          </button>
        </form>
      </header>

      {badPhone ? <Banner tone="error">המספר לא תקין.</Banner> : null}
      {waError ? <Banner tone="error">WhatsApp: {waError}</Banner> : null}
      {callsError ? <Banner tone="error">שיחות טלפון: {callsError}</Banner> : null}
      {callsStale ? <Banner tone="info">רשימת השיחות מוצגת מהטעינה הקודמת, כי Unipile לא ענה כרגע.</Banner> : null}

      {callsTable ? (
        <section aria-label="שיחות טלפון" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {chips}
            <p className="text-sm text-app-text-secondary">ההקלטות מגיעות אוטומטית מ-Aloha. שם איש הקשר פותח את ציר הזמן שלו.</p>
          </div>
          {!config.hasOpenAiKey ? <Banner tone="info">התמלול עוד לא מוגדר בסביבה הזו. ההאזנה עובדת.</Banner> : null}
          <ul className="space-y-3">
            {calls.map((call) => {
              const o = owners.get(call.other);
              const name = o?.personName ?? call.other;
              return (
                <li key={call.emailId} className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ChannelIcon channel="call" />
                      <div className="min-w-0">
                        <Link href={href({ c: phoneKey(call.other) })} className="font-medium text-app-text-primary underline-offset-2 hover:underline">
                          {name}
                        </Link>
                        <p className="text-xs text-app-text-secondary">
                          {DIRECTION_SHORT[call.direction] ? `${DIRECTION_SHORT[call.direction]} · ` : ""}
                          {formatDateTime(call.callAt)}
                          {call.sizeBytes ? ` · ${formatSize(call.sizeBytes)}` : ""}
                          {o?.personName ? (
                            <span dir="ltr" className="ms-1">
                              {call.other}
                            </span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    {o && o.clients.length > 0 ? (
                      <ClientTag clients={o.clients} />
                    ) : (
                      <Link
                        href={href({ c: phoneKey(call.other) })}
                        className="inline-flex min-h-9 items-center rounded-full border border-dashed border-app-warning px-3 text-xs text-app-warning"
                      >
                        שיוך ללקוח
                      </Link>
                    )}
                  </div>
                  <RecordingPlayer src={recordingHref(call.emailId)} />
                  {config.hasOpenAiKey ? <TranscribeButton kind="recording" emailId={call.emailId} /> : null}
                </li>
              );
            })}
            {calls.length === 0 && !callsError ? <li className="text-sm text-app-text-secondary">אין הקלטות.</li> : null}
          </ul>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_17rem]">
          {/* The list. On a phone it gives way to the open conversation. */}
          <nav
            aria-label="אנשי קשר"
            className={`${isOpen ? "hidden lg:flex" : "flex"} max-h-[78vh] flex-col overflow-hidden rounded-2xl border border-app-border bg-white`}
          >
            <div className="space-y-3 border-b border-app-border p-3">
              <form method="get" action={BASE}>
                {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
                <label htmlFor="inbox-q" className="sr-only">
                  חיפוש
                </label>
                <input
                  id="inbox-q"
                  name="q"
                  type="search"
                  defaultValue={query}
                  placeholder="חיפוש לפי שם, מספר או לקוח"
                  className="w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
                />
              </form>
              {chips}
            </div>
            <ul className="flex-1 divide-y divide-app-border overflow-y-auto">
              {visible.map((row) => {
                const active = row.key === openKey;
                return (
                  <li key={row.key}>
                    <Link
                      href={href({ c: row.key, filter, q: query })}
                      aria-current={active ? "page" : undefined}
                      className={`flex gap-3 px-3 py-3 ${active ? "bg-app-accent-soft" : "hover:bg-app-surface-sunken"}`}
                    >
                      <ChannelIcon channel={row.channel} />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[15px] font-medium text-app-text-primary">{row.name}</span>
                          <span className="flex-none text-xs text-app-text-secondary">{formatListTime(row.at, now)}</span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] text-app-text-secondary">{row.preview}</span>
                          {row.unreadCount > 0 ? (
                            <span className="flex-none rounded-full bg-gold px-2 text-xs text-white">{row.unreadCount}</span>
                          ) : null}
                        </span>
                        {row.phone ? <ClientTag clients={row.clients} /> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {visible.length === 0 ? (
                <li className="p-4 text-sm text-app-text-secondary">{query || filter !== "all" ? "אין תוצאות." : "אין שיחות."}</li>
              ) : null}
            </ul>
          </nav>

          {/* The timeline of the open contact. */}
          <section
            aria-label="ציר זמן"
            className={`${isOpen ? "flex" : "hidden lg:flex"} min-h-[24rem] flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface-page`}
          >
            {isOpen ? (
              <>
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border bg-white px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      href={href({ filter, q: query })}
                      aria-label="חזרה לרשימה"
                      className="flex size-11 flex-none items-center justify-center rounded-lg text-app-text-primary lg:hidden"
                    >
                      <ArrowRight className="size-5" aria-hidden="true" />
                    </Link>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-medium text-app-text-primary">{contactName}</h2>
                      {selectedPhone ? (
                        <p dir="ltr" className="text-end text-xs text-app-text-secondary">
                          {selectedPhone}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {owner?.clients.map((c) => (
                      <Link
                        key={c.id}
                        href={`/app/clients/${c.id}`}
                        className="inline-flex min-h-9 items-center rounded-lg bg-app-accent-soft px-3 text-[13px] font-medium text-app-text-accent"
                      >
                        לקוח: {c.name}
                      </Link>
                    ))}
                    <TaskFromConversation
                      clients={clientOptions}
                      defaultClientId={owner?.clients.length === 1 ? owner.clients[0].id : null}
                      title={proposal.title}
                      description={proposal.description}
                    />
                  </div>
                </header>

                <ol className="flex-1 space-y-3 overflow-y-auto p-4 sm:px-6">
                  {timeline.map((item, i) => {
                    const prev = timeline[i - 1];
                    const newDay = !prev || dayKey(prev.at) !== dayKey(item.at);
                    const day = newDay ? (
                      <li key={`d-${item.at}`} className="flex justify-center">
                        <span className="rounded-full bg-app-surface-sunken px-3 py-1 text-xs text-app-text-secondary">{formatDay(item.at)}</span>
                      </li>
                    ) : null;
                    if (item.kind === "message") {
                      const m = messageById.get(item.id);
                      return m && chat ? [day, <MessageBubble key={`m-${m.id}`} m={m} chat={chat} />] : day;
                    }
                    const call = callById.get(item.id);
                    return call ? [day, <CallCard key={`c-${call.emailId}`} call={call} transcribe={config.hasOpenAiKey} />] : day;
                  })}
                  {timeline.length === 0 ? <li className="text-sm text-app-text-secondary">אין הודעות או שיחות להצגה.</li> : null}
                </ol>

                {chat ? (
                  mayReply ? (
                    <div className="bg-white">
                      <SendForm chatId={chat.id} />
                    </div>
                  ) : (
                    <p className="border-t border-app-border bg-white p-4 text-xs text-app-text-secondary">
                      בשלב הבדיקה: שליחה רק לשיחה אישית עם מספר שברשימת הבדיקה.
                    </p>
                  )
                ) : selectedPhone && waReady ? (
                  <div className="border-t border-app-border bg-white p-4 text-sm text-app-text-secondary">
                    {lookedUp ? (
                      "לא נמצאה שיחת WhatsApp עם המספר הזה."
                    ) : (
                      <Link href={href({ c: phoneKey(selectedPhone), filter, q: query, wa: true })} className="inline-flex min-h-11 items-center text-app-text-primary underline">
                        חיפוש שיחת WhatsApp עם המספר הזה
                      </Link>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="m-auto p-6 text-sm text-app-text-secondary">בחרו איש קשר מהרשימה, או פתחו לפי מספר.</p>
            )}
          </section>

          {/* The contact, from the client files. */}
          {isOpen ? (
            <aside aria-label="איש קשר" className="space-y-5 rounded-2xl border border-app-border bg-white p-4 lg:col-span-2 xl:col-span-1">
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-app-text-secondary">איש קשר</h3>
                <p className="font-medium text-app-text-primary">{contactName}</p>
                {owner && owner.clients.length > 0 ? (
                  <ul className="space-y-1">
                    {owner.clients.map((c) => (
                      <li key={c.id}>
                        <Link href={`/app/clients/${c.id}`} className="inline-flex min-h-9 items-center text-sm text-app-text-accent underline">
                          לתיק הלקוח: {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : selectedPhone ? (
                  <p className="text-sm text-app-text-secondary">המספר לא מופיע באף תיק לקוח.</p>
                ) : null}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-medium text-app-text-secondary">ב-30 הימים האחרונים</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-app-surface-sunken p-2.5">
                    <p className="text-xl font-medium text-app-text-primary">{countSince(messages, (m) => m.timestamp, since30)}</p>
                    <p className="text-xs text-app-text-secondary">הודעות</p>
                  </div>
                  <div className="rounded-lg bg-app-surface-sunken p-2.5">
                    <p className="text-xl font-medium text-app-text-primary">{countSince(contactCalls, (c) => c.callAt, since30)}</p>
                    <p className="text-xs text-app-text-secondary">שיחות</p>
                  </div>
                </div>
                <p className="text-xs text-app-text-tertiary">מתוך 40 ההודעות ו-25 ההקלטות האחרונות שנטענו.</p>
              </section>

              {selectedPhone ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium text-app-text-secondary">מספרים מוכרים</h3>
                  <ul dir="ltr" className="space-y-0.5 text-end text-sm text-app-text-primary">
                    {(owner?.phones.length ? owner.phones : [selectedPhone]).map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  {owner && owner.contacts.length > 0 ? (
                    <AddNumberForm contactId={owner.contacts[0].id} />
                  ) : (
                    <AssignToClientForm phone={selectedPhone} defaultName={chat?.name && chat.name !== "ללא שם" ? chat.name : ""} clients={clientOptions} />
                  )}
                </section>
              ) : null}
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}

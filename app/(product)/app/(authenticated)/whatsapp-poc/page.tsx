import Link from "next/link";
import { cookies } from "next/headers";
import { getFormatter, getTranslations } from "next-intl/server";
import { useFormatter, useTranslations } from "next-intl";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { ArrowRight, ChevronDown, MessageCircle, MoreHorizontal, Phone, Search } from "lucide-react";
import { ContactRail, ReadToggle, RememberFilters, RowPending, TimelineScroller } from "./CommsControls";
import { ScrollToActive } from "./ScrollToActive";
import { BlockButton } from "./setup/SetupForms";
import { searchStoredMessages, type MessageHit, type StoredTranscript } from "@/lib/comms/stored-chats";
import { countChatsToReview } from "@/lib/comms/new-chats";
import { requireUser } from "@/lib/app-auth/session";
import { Forbidden } from "@/components/app/Forbidden";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { canReplyTo } from "@/lib/whatsapp-poc/access";
import { canSeeCall, commsAccess } from "@/lib/comms/access";
import { storedCallLine } from "@/lib/comms/call-lines";
import { lineOwnerEmails as lineOwnerEmailsFromGrants } from "@/lib/comms/grants";
import {
  chatsWithPhone,
  findChat,
  infoOf,
  isStored,
  loadMessages,
  loadWhatsapp,
  lookupAccounts,
  numberKeyOf,
  ownFirst,
  type ChannelInfo,
  type PageMessage,
  type WaChat,
} from "@/lib/comms/inbox-loader";
import { matchPhones, type PhoneMatch } from "@/lib/whatsapp-poc/clients-by-phone";
import { normalizePhone } from "@/lib/contact-normalize";
import {
  INBOX_FILTERS,
  LINE_RECORDINGS_NAME,
  NO_NAME,
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
  displayPhone,
  isPlausiblePhone,
  isUnread,
  snippetAround,
  chatKey,
  proposeTask,
  type ChatRef,
  type InboxCall,
  type InboxFilter,
  type InboxRow,
} from "@/lib/whatsapp-poc/inbox";
import { callSide, listRecordingsCached, type Recording } from "@/lib/whatsapp-poc/recordings";
import {
  UnipileError,
  readPocConfig,
  type PocChat,
  type PocMessage,
  type PocQuote,
} from "@/lib/whatsapp-poc/unipile";
import { SendForm } from "./SendForm";
import { AddNumberForm, AssignToClientForm, GroupClientForm } from "./ContactForms";
import { TaskFromConversation } from "./TaskFromConversation";
import { HideWhileSelecting, MessageSelectionProvider, SelectModeButton, SelectToggle } from "./MessageSelection";
import { contentFileLabel, proposeSelectedTitle, type SelectedMessage } from "@/lib/whatsapp-poc/selected-messages";
import { RecordingPlayer } from "./calls/RecordingPlayer";
import { TranscribeButton, TranscriptText } from "./calls/TranscribeButton";
import { prisma } from "@/lib/prisma";
import type { TranscriptStatus } from "@prisma/client";

// Communications screen (1.11.2026, from Ariel's review of the design on
// Claude Design): WhatsApp and the Aloha line's call recordings in one
// place. One list, one row per person; one timeline per person mixing
// messages, voice messages and calls; the person's client file beside it.
// The recordings used to be a separate page behind a link
// (/app/whatsapp-poc/calls, which now redirects here).
//
// 5.11.2026 (Ariel, designs on Claude Design): the contact card is a
// narrow column, a "צוות" filter, the block action in "עוד", the timeline
// oldest first inside its own scroll, text search in stored messages, and
// "סמן כנקראה" on a click.
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

type Href = {
  c?: string | null;
  filter?: InboxFilter;
  team?: string;
  q?: string;
  inMessages?: boolean;
  m?: string;
  wa?: boolean;
  assign?: boolean;
  before?: string;
};

/// Links inside the screen always carry the filters, so a bare visit (from
/// the menu) is how the screen knows to restore the last ones (5.11.2026).
function href(params: Href) {
  const q = new URLSearchParams();
  if (params.filter) q.set("filter", params.filter);
  if (params.team) q.set("team", params.team);
  if (params.q) q.set("q", params.q);
  if (params.inMessages) q.set("in", "msg");
  if (params.m) q.set("m", params.m);
  if (params.c) q.set("c", params.c);
  if (params.wa) q.set("wa", "1");
  if (params.assign) q.set("assign", "1");
  if (params.before) q.set("before", params.before);
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

// ADR 0006: times are shown in the reader's language and time zone. Which
// day a message belongs to (dayKey, "yesterday") stays Israel time.
type Format = ReturnType<typeof useFormatter>;
type T = ReturnType<typeof useTranslations<"comms">>;

function formatTime(format: Format, iso: string) {
  return format.dateTime(new Date(iso), { timeStyle: "short" });
}

function formatListTime(format: Format, t: T, iso: string | null, now: Date) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (dayKey(iso) === dayKey(now.toISOString())) return formatTime(format, iso);
  if (dayKey(iso) === dayKey(new Date(now.getTime() - DAY_MS).toISOString())) return t("list.yesterday");
  return format.dateTime(date, { day: "numeric", month: "numeric" });
}

function formatDay(format: Format, iso: string) {
  return format.dateTime(new Date(iso), { weekday: "long", day: "numeric", month: "long" });
}

function formatDateTime(format: Format, iso: string) {
  return format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });
}

/// A name as the screen shows it: the words the system gives a nameless chat
/// and the hand-sent recordings' row are the reader's (ADR 0006).
function shownName(t: T, name: string) {
  if (name === NO_NAME) return t("noName");
  if (name === LINE_RECORDINGS_NAME) return t("calls.noOtherSide");
  return name;
}

function shownPhone(t: T, phone: string | null | undefined) {
  return displayPhone(phone, t("phone.whatsappId"));
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const ATTACHMENT_KEY: Record<string, "image" | "video" | "voice" | "file" | "sticker"> = {
  img: "image",
  image: "image",
  video: "video",
  audio: "voice",
  file: "file",
  sticker: "sticker",
};

/// The word for a file on the screen. What goes into a task is
/// contentFileLabel's Hebrew word (content, ADR 0006).
function attachmentLabel(t: T, a: PocMessage["attachments"][number]) {
  if (a.voiceNote) return t("message.attachment.voice");
  return t(`message.attachment.${ATTACHMENT_KEY[a.type] ?? "file"}`);
}

function mediaHref(chatId: string, messageId: string, attachmentId: string, numberKey: string) {
  return `/api/whatsapp-poc/media/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}?n=${encodeURIComponent(numberKey)}`;
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
  const t = useTranslations("comms");
  if (clients.length === 0) {
    return <span className="self-start rounded-full bg-app-warning-soft px-2 py-0.5 text-xs text-app-warning">{t("filters.none")}</span>;
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

/// What the mark mode needs to know about one message (MessageSelection.tsx).
function selectable(m: PageMessage, transcript?: StoredTranscript): SelectedMessage {
  return {
    id: m.id,
    at: m.timestamp,
    text: m.text,
    mine: m.isSender,
    senderName: m.senderName,
    // The label is written into the task's comment: content, in Hebrew.
    files: m.attachments.flatMap((a) => (a.id ? [{ id: a.id, type: a.type, label: contentFileLabel(a) }] : [])),
    // 4.11.2026 (Ariel): a voice message goes into the task with its
    // transcript, when there is one.
    transcript: transcript?.status === "DONE" && transcript.text ? transcript.text : null,
  };
}

/// The anchor a reply's quote jumps to (13.11.2026, Ariel: as in WhatsApp,
/// a click on the quote goes back to the original message). Plain HTML: the
/// browser scrolls the timeline to it, and :target marks it.
function messageAnchor(id: string) {
  return `wa-${id}`;
}

/// The quote at the top of a reply: who wrote the original and what it
/// said. When the original is in the timeline, the quote links to it.
function QuoteBlock({ quote, original, mine, chat }: { quote: PocQuote; original: PageMessage | undefined; mine: boolean; chat: PocChat }) {
  const t = useTranslations("comms");
  const name = original ? (original.isSender ? t("message.quote.us") : (original.senderName ?? quote.senderName ?? chat.name)) : (quote.senderName ?? chat.name);
  const deleted = original?.isDeleted === true;
  const text = deleted ? "" : original ? original.text || quote.text : quote.text;
  const kind = original && !deleted ? (original.attachments[0] ? (original.attachments[0].voiceNote ? "voice" : original.attachments[0].type) : quote.kind) : quote.kind;
  const preview = deleted
    ? t("message.quote.deleted")
    : text
      ? text
      : kind
        ? t(`message.attachment.${kind === "voice" ? "voice" : (ATTACHMENT_KEY[kind] ?? "file")}`)
        : t("message.quote.empty");
  const cls = `block rounded-lg border-s-4 px-2.5 py-1.5 text-start text-[13px] ${
    mine ? "border-gold bg-white/10 text-white/90" : "border-gold bg-app-surface-sunken text-app-text-secondary"
  }`;
  const body = (
    <>
      <span className={`block text-xs font-medium ${mine ? "text-white" : "text-app-text-accent"}`}>{t("message.quote.label", { name })}</span>
      <span dir="auto" className={`line-clamp-2 whitespace-pre-wrap break-words ${deleted || !text ? "italic" : ""}`}>
        {preview}
      </span>
    </>
  );
  return original ? (
    <a href={`#${messageAnchor(original.id)}`} aria-label={`${t("message.quote.jump")}: ${preview}`} className={`${cls} min-h-11 hover:opacity-90`}>
      {body}
    </a>
  ) : (
    <div className={cls} title={t("message.quote.notLoaded")}>
      {body}
      <span className={`mt-0.5 block text-[11px] ${mine ? "text-white/70" : "text-app-text-secondary"}`}>{t("message.quote.notLoaded")}</span>
    </div>
  );
}

function MessageBubble({
  m,
  chat,
  transcript,
  hit,
  quoted,
}: {
  m: PageMessage;
  chat: PocChat;
  transcript?: StoredTranscript;
  hit?: boolean;
  /// The message m answers, when it is in the timeline.
  quoted?: PageMessage;
}) {
  const t = useTranslations("comms");
  const format = useFormatter();
  const mine = m.isSender;
  return (
    <li
      id={messageAnchor(m.id)}
      data-hit={hit ? "" : undefined}
      className={`flex scroll-mt-4 items-center gap-1 rounded-2xl target:ring-2 target:ring-gold target:ring-offset-4 ${mine ? "justify-end" : "justify-start"} ${hit ? "ring-2 ring-gold ring-offset-4" : ""}`}
    >
      {m.isDeleted ? null : <SelectToggle message={selectable(m, transcript)} />}
      <div
        className={`max-w-[85%] space-y-1 px-3.5 py-2.5 text-[15px] sm:max-w-[65%] ${
          mine ? "rounded-2xl rounded-ee-md bg-navy text-white" : "rounded-2xl rounded-es-md border border-app-border bg-white text-app-text-primary"
        }`}
      >
        {!mine && chat.type === "group" && m.senderName ? <p dir="auto" className="text-xs font-medium text-app-text-secondary">{m.senderName}</p> : null}
        {m.quoted && !m.isDeleted ? <QuoteBlock quote={m.quoted} original={quoted} mine={mine} chat={chat} /> : null}
        {m.isDeleted ? (
          <p className={`italic ${mine ? "text-white/70" : "text-app-text-secondary"}`}>{t("message.deleted")}</p>
        ) : !m.text && m.attachments.length === 0 ? (
          // Unipile returns some WhatsApp kinds (a poll, a location, a
          // contact card, some stickers) with neither text nor attachment.
          <p className={`italic ${mine ? "text-white/70" : "text-app-text-secondary"}`}>{t("message.unsupported")}</p>
        ) : m.text ? (
          <p dir="auto" className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>
        ) : null}
        {m.attachments.map((a, i) =>
          a.type === "audio" && a.id ? (
            <div key={i} className="min-w-64 space-y-2 rounded-xl bg-white p-2 text-app-text-primary">
              <p className="text-xs text-app-text-secondary">
                {attachmentLabel(t, a)}
                {a.duration ? ` · ${formatDuration(a.duration)}` : ""}
              </p>
              <RecordingPlayer src={`/api/whatsapp-poc/voice/${encodeURIComponent(m.chatId)}/${encodeURIComponent(m.id)}?n=${encodeURIComponent(m.numberKey)}`} />
              {transcript?.status === "DONE" && transcript.text ? (
                <TranscriptText text={transcript.text} />
              ) : transcript?.status === "PENDING" ? (
                <p className="text-xs text-app-text-secondary">{t("calls.pendingShort")}</p>
              ) : transcript?.status === "SKIPPED" ? (
                <p className="text-xs text-app-text-secondary">{t("calls.skipped")}</p>
              ) : (
                <TranscribeButton kind="voice" chatId={m.chatId} messageId={m.id} numberKey={m.numberKey} />
              )}
            </div>
          ) : a.id && (a.type === "img" || a.type === "image") ? (
            <a key={i} href={mediaHref(m.chatId, m.id, a.id, m.numberKey)} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- a private, per-request file; next/image would cache it */}
              <img src={mediaHref(m.chatId, m.id, a.id, m.numberKey)} alt={attachmentLabel(t, a)} loading="lazy" className="max-h-72 max-w-full rounded-lg" />
            </a>
          ) : a.id && a.type === "video" ? (
            <video key={i} controls preload="none" className="max-h-72 max-w-full rounded-lg" src={mediaHref(m.chatId, m.id, a.id, m.numberKey)} />
          ) : a.id ? (
            <a key={i} href={mediaHref(m.chatId, m.id, a.id, m.numberKey)} className="inline-flex min-h-11 items-center text-xs underline">
              {t("message.download", { label: attachmentLabel(t, a) })}
            </a>
          ) : (
            <p key={i} className="text-xs opacity-80">
              [{attachmentLabel(t, a)}]
            </p>
          ),
        )}
        <p className={`text-[11px] ${mine ? "text-white/75" : "text-app-text-secondary"}`}>
          {formatTime(format, m.timestamp)}
          {mine ? ` · ${t("message.sent")}` : ""}
        </p>
      </div>
    </li>
  );
}

type PageCall = InboxCall & {
  sizeBytes: number | null;
  durationSec: number | null;
  /// Null for a recording read live from the mailbox (nothing stored yet).
  transcript: { status: TranscriptStatus; text: string | null } | null;
  audioRemoved: boolean;
  /// Which of our lines the call was on, when known.
  line: string | null;
};

/// What sits under a recording's player: the stored transcript, its state,
/// or (for one read live, or a failed one) the button.
function CallTranscript({ call, canTranscribe }: { call: PageCall; canTranscribe: boolean }) {
  const t = useTranslations("comms");
  const tr = call.transcript;
  if (tr?.status === "DONE" && tr.text) return <TranscriptText text={tr.text} />;
  if (tr?.status === "SKIPPED") return <p className="text-sm text-app-text-secondary">{t("calls.skipped")}</p>;
  if (tr?.status === "PENDING") return <p className="text-sm text-app-text-secondary">{t("calls.pendingLong")}</p>;
  if (!canTranscribe) return null;
  return (
    <div className="space-y-1">
      {tr?.status === "FAILED" ? <p className="text-sm text-app-error">{t("calls.failed")}</p> : null}
      <TranscribeButton kind="recording" emailId={call.emailId} label={tr?.status === "FAILED" ? t("calls.retry") : t("calls.transcribe")} />
    </div>
  );
}

function callMeta(t: T, call: PageCall) {
  const parts: string[] = [];
  if (call.durationSec) parts.push(t("calls.minutes", { duration: formatDuration(call.durationSec) }));
  else if (call.sizeBytes) parts.push(formatSize(call.sizeBytes));
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

type CallTaskContext = { contactName: string; phone: string | null; clients: Array<{ id: string; name: string }>; defaultClientId: string | null };

/// "משימה מהשיחה הזו" (4.11.2026, Ariel): a task from one phone call, its
/// transcript in the details. The header's "צור משימה מהשיחה" proposes only
/// the latest call, and the calls list had no way to start a task at all.
function CallTaskButton({ call, ctx }: { call: PageCall; ctx: CallTaskContext }) {
  const t = useTranslations("comms");
  // The proposed title and details are written into a task: content, in
  // Hebrew (ADR 0006).
  const proposal = proposeTask({
    name: ctx.contactName,
    phone: ctx.phone,
    lastMessages: [],
    lastCall: { at: call.callAt, direction: call.direction },
    transcript: call.transcript?.status === "DONE" ? call.transcript.text : null,
  });
  return (
    <TaskFromConversation
      key={`call-task-${call.emailId}`}
      label={t("calls.taskFromCall")}
      clients={ctx.clients}
      defaultClientId={ctx.defaultClientId}
      title={proposal.title}
      description={proposal.description}
    />
  );
}

function CallCard({ call, transcribe, task }: { call: PageCall; transcribe: boolean; task?: CallTaskContext }) {
  const t = useTranslations("comms");
  const format = useFormatter();
  return (
    <li className="space-y-3 rounded-xl border border-app-info-soft bg-white p-4 ring-1 ring-app-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ChannelIcon channel="call" />
          <div>
            <p className="text-[15px] font-medium text-app-text-primary">{t(`calls.direction.${call.direction}`)}</p>
            <p className="text-xs text-app-text-secondary">
              {formatTime(format, call.callAt)} · {t("calls.ankoraLine")}
              {callMeta(t, call)}
            </p>
          </div>
        </div>
        {task ? <CallTaskButton call={call} ctx={task} /> : null}
      </div>
      {call.audioRemoved ? (
        <p className="text-sm text-app-text-secondary">{t("calls.audioRemoved")}</p>
      ) : (
        <RecordingPlayer src={recordingHref(call.emailId)} />
      )}
      <CallTranscript call={call} canTranscribe={transcribe} />
    </li>
  );
}

const DIRECTION_FROM_DB = { IN: "in", OUT: "out", UNKNOWN: "unknown" } as const;

export default async function CommunicationsPage(props: {
  searchParams: Promise<{
    c?: string;
    filter?: string;
    team?: string;
    q?: string;
    in?: string;
    m?: string;
    phone?: string;
    wa?: string;
    chat?: string;
    assign?: string;
    before?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("comms");
  const format = await getFormatter();
  // A refusal from Unipile, in the reader's language (ADR 0006).
  const errorText = async (err: UnipileError | null) => (err ? ((await domainErrorText(err)) ?? err.message) : null);
  const user = await requireUser();
  const config = readPocConfig();
  const access = await commsAccess(user);
  if (!access.allowed) return <Forbidden />;

  // The last filters come back on a bare visit (5.11.2026, Ariel).
  let remembered: { filter?: string; team?: string } = {};
  if (searchParams.filter === undefined && searchParams.team === undefined) {
    try {
      const raw = (await cookies()).get("comms_filters")?.value;
      if (raw) remembered = JSON.parse(decodeURIComponent(raw)) as typeof remembered;
    } catch {
      remembered = {};
    }
  }
  const filter = parseFilter(searchParams.filter ?? remembered.filter);
  const teamParam = String(searchParams.team ?? remembered.team ?? "all").slice(0, 40);
  const query = (searchParams.q ?? "").slice(0, 80);
  const inMessages = searchParams.in === "msg";
  const hitId = searchParams.m && searchParams.m.length <= 200 ? searchParams.m : null;
  const now = new Date();

  const mailConfig = config.apiKey && config.mailAccountId ? { apiKey: config.apiKey, mailAccountId: config.mailAccountId } : null;

  // WhatsApp: every connected number the person may see (lib/comms/inbox-loader.ts).
  // 5.11.2026: the WhatsApp lists and the stored calls are read side by side.
  const [wa, stored] = await Promise.all([
    loadWhatsapp(user, access),
    // The transcripts' text is read below, only for the calls on screen:
    // reading all 300 on every click was a large part of each load.
    prisma.callRecording.findMany({
      orderBy: { callAt: "desc" },
      take: 300,
      include: { transcript: { select: { id: true, status: true } } },
    }),
  ]);
  const chats = wa.chats;
  let waError: string | null = await errorText(wa.error);
  const waReady = Boolean(config.apiKey);
  const accounts = lookupAccounts(wa, user, access);

  // 1.11.2026 (stage 2): the recordings are stored as they arrive
  // (lib/comms/call-store.ts) and read from here. Until the first are
  // stored, the mailbox is read live as before.
  let calls: PageCall[] = [];
  let callsError: string | null = null;
  let callsStale = false;
  if (stored.length > 0) {
    calls = stored.map((r) => ({
      emailId: r.emailId,
      callAt: r.callAt.toISOString(),
      direction: DIRECTION_FROM_DB[r.direction],
      other: r.otherPhone,
      line: storedCallLine(r),
      sizeBytes: r.sizeBytes,
      durationSec: r.durationSec,
      transcript: r.transcript ? { status: r.transcript.status, text: null } : null,
      audioRemoved: r.audioDeletedAt !== null,
    }));
  } else if (mailConfig) {
    let recordings: Recording[] = [];
    try {
      ({ recordings, stale: callsStale } = await listRecordingsCached(mailConfig));
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      callsError = await errorText(err);
    }
    calls = recordings.map((r) => {
      const side = callSide(r, config.lineNumbers);
      return {
        emailId: r.emailId,
        callAt: r.callAt,
        direction: side.direction,
        other: side.other,
        line: side.line,
        sizeBytes: r.sizeBytes,
        durationSec: null,
        transcript: null,
        audioRemoved: false,
      };
    });
  }

  // Each call only to whom may see it: the full viewers and the call
  // viewers see all, a line's owner every call on their line, an account
  // manager the calls of their clients.
  if (!access.allCalls && calls.length > 0) {
    const callOwners = await matchPhones(calls.map((c) => c.other));
    const ids = [...new Set([...callOwners.values()].flatMap((o) => o.clients.map((c) => c.id)))];
    const managers = new Map(
      (await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, accountManagerId: true } })).map((c) => [c.id, c.accountManagerId]),
    );
    calls = calls.filter((c) =>
      canSeeCall(
        access,
        user.id,
        (callOwners.get(c.other)?.clients ?? []).map((cl) => ({ accountManagerId: managers.get(cl.id) ?? null })),
        c.line,
      ),
    );
  }

  // Which contact is open: from the list (?c=), an old link (?chat=), or
  // the "open by number" box (?phone=).
  let selectedKey = parseKey(searchParams.c);
  if (!selectedKey && searchParams.chat && searchParams.chat.length <= 200) selectedKey = { chatId: searchParams.chat };
  const typedPhone = searchParams.phone ? normalizePhone(searchParams.phone.slice(0, 40)) : null;
  const phoneFromBox = typedPhone && /^\+\d{8,15}$/.test(typedPhone) ? typedPhone : null;
  if (phoneFromBox) selectedKey = { phone: phoneFromBox };
  const badPhone = Boolean(searchParams.phone) && !phoneFromBox;

  // The chats of the open contact. A number with no chat in the lists is
  // looked up at Unipile only when asked (the box, or the "find" link),
  // because every lookup counts against the quota.
  let chat: PocChat | null = null;
  // The person's own number first (12.11.2026): its chat is the one the
  // reply, the block button and the rail act on.
  let openChats: WaChat[] = [];
  let found: Awaited<ReturnType<typeof findChat>> = null;
  let selectedPhone: string | null = null;
  let lookedUp = false;
  if (selectedKey && "phone" in selectedKey) {
    selectedPhone = selectedKey.phone;
    openChats = ownFirst(wa, chatsWithPhone(wa, selectedPhone), user.id);
    chat = openChats[0] ?? null;
    if (!chat && accounts.length > 0 && (phoneFromBox || searchParams.wa === "1")) {
      lookedUp = true;
      try {
        found = await findChat(accounts, { phone: selectedPhone });
        chat = found?.chat ?? null;
      } catch (err) {
        if (!(err instanceof UnipileError)) throw err;
        waError = await errorText(err);
      }
    }
  } else if (selectedKey && "chatId" in selectedKey) {
    const id = selectedKey.chatId;
    // A group with two of our numbers in it has the same id on both.
    openChats = ownFirst(wa, chats.filter((c) => c.id === id), user.id);
    chat = openChats[0] ?? null;
    if (!chat && accounts.length > 0) {
      try {
        found = await findChat(accounts, { chatId: id });
        chat = found?.chat ?? null;
      } catch (err) {
        if (!(err instanceof UnipileError)) throw err;
        waError = await errorText(err);
      }
    }
    selectedPhone = chat ? chatPhone(chat) : null;
  }

  // Older messages: ?before=<instant> shows the 200 before it.
  const beforeParam = searchParams.before && !Number.isNaN(Date.parse(searchParams.before)) ? new Date(searchParams.before) : null;
  const loaded = chat
    ? await loadMessages(wa, openChats, found, beforeParam)
    : { messages: [] as PageMessage[], transcripts: new Map<string, StoredTranscript>(), error: null, hasOlder: false };
  const messages = loaded.messages;
  const voiceTranscripts = loaded.transcripts;
  if (loaded.error) waError = await errorText(loaded.error);
  // The open chat's number: where the block button and the reply act.
  const chatInfo: ChannelInfo | null = !chat ? null : openChats[0] ? infoOf(wa, openChats[0]) : (found?.info ?? null);

  const owners = await matchPhones([
    ...chats.map((c) => chatPhone(c)).filter((p): p is string => Boolean(p)),
    ...calls.map((c) => c.other),
    ...(selectedPhone ? [selectedPhone] : []),
  ]);
  // 2.11.2026: recordings Aloha sent by hand have no other side, and are
  // stored on our own line's number. They gather in one row per line, named
  // for what it is, and the line is never offered for a client's file.
  for (const line of config.lineNumbers) {
    if (calls.some((c) => c.other === line)) {
      owners.set(line, { personName: LINE_RECORDINGS_NAME, clients: [], phones: [line], contacts: [] });
    }
  }
  // "צוות" (5.11.2026, Ariel): a chat belongs to its number's owner, a
  // call to its line's owner (lib/comms/grants.ts: the app, then ALOHA_LINE_OWNERS).
  const lineOwnerEmails = await lineOwnerEmailsFromGrants();
  const lineOwnerUsers = lineOwnerEmails.size
    ? await prisma.user.findMany({ where: { email: { in: [...new Set(lineOwnerEmails.values())] } }, select: { id: true, email: true, name: true } })
    : [];
  const userByEmail = new Map(lineOwnerUsers.map((u) => [u.email.toLowerCase(), u]));
  const lineOwnerOf = (line: string | null) => (line ? (userByEmail.get(lineOwnerEmails.get(line) ?? "")?.id ?? null) : null);
  const rows = buildInbox(chats, calls, owners, {
    chat: (c) => (c.numberKey ? wa.numbers.get(c.numberKey)?.ownerUserId : null),
    call: (c) => lineOwnerOf((c as PageCall).line),
  });
  const teamNames = new Map<string, string>();
  for (const ch of wa.channels) if ([...wa.numbers.values()].some((i) => i.id === ch.id)) teamNames.set(ch.ownerUserId, ch.owner.name ?? "");
  for (const u of lineOwnerUsers) if (calls.some((c) => lineOwnerOf(c.line) === u.id)) teamNames.set(u.id, u.name ?? u.email);
  const team = teamParam === "me" ? user.id : teamNames.has(teamParam) ? teamParam : null;
  const teamValue = teamParam === "me" ? "me" : team ?? "all";
  const teamMembers = [...teamNames]
    .map(([id, name]) => ({ id, name: name || t("noName"), count: rows.filter((r) => r.teamIds.includes(id)).length }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
  const teamLabel = teamValue === "me" ? t("team.me") : team ? (teamNames.get(team) || t("noName")) : t("team.all");
  const visible = filterInbox(rows, filter, inMessages ? "" : query, team);

  // "חיפוש בתוך ההודעות" (5.11.2026): stored conversations only.
  // Each number with its own chats (12.11.2026): see searchStoredMessages.
  const searchable = new Map<string, string[]>();
  for (const c of chats) {
    if (!isStored(wa, c)) continue;
    const list = searchable.get(c.numberKey) ?? [];
    list.push(c.id);
    searchable.set(c.numberKey, list);
  }
  const hits: MessageHit[] = inMessages && query ? await searchStoredMessages(searchable, query) : [];
  const keyOfChat = (chatId: string, numberKey: string) => {
    const c = chats.find((x) => x.id === chatId && x.numberKey === numberKey);
    const p = c ? chatPhone(c) : null;
    return p ? phoneKey(p) : chatKey(chatId);
  };
  // Who may mark a chat read: its number's owner, or the full viewers.
  const readTarget = ({ chatId, numberKey }: ChatRef) => {
    const info = numberKey ? wa.numbers.get(numberKey) : null;
    if (!info || !(info.ownerUserId === user.id || access.full)) return null;
    return { chatId, numberKey: numberKeyOf(info) };
  };
  const readTargets = (refs: ChatRef[]) => refs.map(readTarget).filter((t): t is { chatId: string; numberKey: string } => t !== null);

  const isOpen = Boolean(selectedKey) && (Boolean(chat) || Boolean(selectedPhone));
  const openKey = selectedPhone ? phoneKey(selectedPhone) : chat ? chatKey(chat.id) : null;
  const openRow: InboxRow | undefined = rows.find((r) => r.key === openKey);
  const owner: PhoneMatch | undefined = selectedPhone ? owners.get(selectedPhone) : undefined;
  const contactCalls = selectedPhone ? calls.filter((c) => c.other === selectedPhone) : [];
  // The transcripts' text, for the calls this screen shows: the open
  // contact's, or every call on the calls table.
  const onScreen = (filter === "call" && !isOpen ? calls : contactCalls).filter((c) => c.transcript?.status === "DONE");
  if (onScreen.length > 0) {
    const texts = await prisma.transcript.findMany({
      where: { status: "DONE", recording: { emailId: { in: onScreen.map((c) => c.emailId) } } },
      select: { text: true, recording: { select: { emailId: true } } },
    });
    const textOf = new Map(texts.map((t) => [t.recording?.emailId ?? "", t.text]));
    for (const c of onScreen) if (c.transcript) c.transcript = { ...c.transcript, text: textOf.get(c.emailId) ?? null };
  }
  const timeline = buildTimeline(messages, contactCalls);
  const messageById = new Map(messages.map((m) => [m.id, m]));
  const callById = new Map(contactCalls.map((c) => [c.emailId, c]));
  const contactName = owner?.personName ?? openRow?.name ?? chat?.name ?? selectedPhone ?? "";
  // A reply goes out only from the person's own number (or, for the full
  // viewers, the configured number before it was connected). 5.11.2026: to
  // any one to one chat or group, unless WHATSAPP_POC_SEND_MODE is "test".
  const replyAs =
    chat && chatInfo && (chatInfo.ownerUserId === user.id || (chatInfo.id === null && access.full)) ? chatInfo : null;
  const mayReply = chat !== null && replyAs !== null && canReplyTo(chat, config.sendMode, config.sendTo);
  // Why there is no reply box, in words.
  const noReplyReason = !chat
    ? ""
    : chat.readOnly
      ? t("noReply.readOnly")
      : replyAs === null
        ? t("noReply.notYours", { owner: chatInfo?.label || t("noReply.someoneElse") })
        : config.sendMode === "test"
          ? t("noReply.testMode")
          : t("noReply.kinds");

  const accessible = isOpen || filter === "call" ? await listAccessibleClients(user) : [];
  const clientOptions = accessible.map((c) => ({ id: c.id, name: c.name }));
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const proposal = proposeTask({
    name: contactName,
    phone: selectedPhone,
    lastMessages: messages.map((m) => ({ text: m.text, isSender: m.isSender })),
    lastCall: contactCalls[0] ? { at: contactCalls[0].callAt, direction: contactCalls[0].direction } : null,
    transcript: contactCalls.find((c) => c.transcript?.status === "DONE")?.transcript?.text ?? null,
  });

  const callsTable = filter === "call" && !isOpen;
  // "שיחות חדשות לבדיקה" (design 9): on the numbers this person decides on.
  const toReview = (
    await Promise.all(
      wa.channels.filter((c) => c.storeEnabled && (c.ownerUserId === user.id || access.manager)).map((c) => countChatsToReview(c)),
    )
  ).reduce((a, b) => a + b, 0);
  const openTargets = readTargets(openChats.map((c) => ({ chatId: c.id, numberKey: c.numberKey })));
  const openUnread = openRow ? isUnread(openRow) : (chat?.unreadCount ?? 0) !== 0;

  // The list's filters (design 8ב, 5.11.2026): two menus side by side,
  // "סוג" and "צוות", each showing what is chosen. Until then the type was
  // four chips over two lines and the team menu a third line under them.
  // Each is a <details>, so it works without script; each choice is a link
  // that keeps the rest.
  const menu = (props: {
    label: string;
    value: string;
    active: boolean;
    align: "start" | "end";
    items: Array<{ id: string; name: string; count?: number; href: string; current: boolean }>;
  }) => (
    <details className="relative min-w-0 flex-1">
      <summary
        className={`flex min-h-10 cursor-pointer list-none items-center justify-between gap-1 rounded-lg border px-3 text-[13px] ${
          props.active ? "border-navy bg-app-accent-soft font-medium text-app-text-primary" : "border-app-border-strong bg-white text-app-text-primary"
        }`}
      >
        <span className="truncate">
          <span className="font-normal text-app-text-secondary">{props.label}:</span> <bdi>{props.value}</bdi>
        </span>
        <ChevronDown className="size-3.5 flex-none" aria-hidden="true" />
      </summary>
      {/* Opens toward the inside of the list, so nothing is cut off. */}
      <ul className={`absolute ${props.align === "start" ? "start-0" : "end-0"} z-20 mt-1 w-52 max-w-[calc(100vw-2rem)] rounded-xl border border-app-border bg-white py-1 shadow-lg`}>
        {props.items.map((m) => (
          <li key={m.id}>
            <Link
              prefetch={false}
              href={m.href}
              aria-current={m.current ? "page" : undefined}
              className={`flex min-h-11 items-center justify-between gap-2 px-3 text-sm text-app-text-primary hover:bg-app-surface-sunken ${
                m.current ? "bg-app-accent-soft font-medium" : ""
              }`}
            >
              <bdi>{m.name}</bdi>
              {m.count !== undefined ? <span className="text-xs text-app-text-secondary">{m.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );

  const typeMenu = menu({
    label: t("filters.label"),
    value: t(`filters.${filter}`),
    active: filter !== "all",
    align: "start",
    items: INBOX_FILTERS.map((f) => ({
      id: f,
      name: t(`filters.${f}`),
      href: href({ filter: f, team: teamValue, q: query, inMessages, c: callsTable || f === "call" ? null : openKey }),
      current: filter === f,
    })),
  });

  const teamMenu =
    teamMembers.length > 0
      ? menu({
          label: t("team.label"),
          value: teamLabel,
          active: teamValue !== "all",
          align: "end",
          items: [
            { id: "all", name: t("team.all"), count: rows.length },
            ...(teamNames.has(user.id) ? [{ id: "me", name: t("team.onlyMine"), count: rows.filter((r) => r.teamIds.includes(user.id)).length }] : []),
            ...teamMembers.filter((m) => m.id !== user.id || !teamNames.has(user.id)),
          ].map((m) => ({
            ...m,
            href: href({ filter, team: m.id, q: query, inMessages, c: callsTable ? null : openKey }),
            current: teamValue === m.id,
          })),
        })
      : null;

  const filterRow = (
    <div className="flex gap-2" role="group" aria-label={t("list.filtersAria")}>
      {typeMenu}
      {teamMenu}
    </div>
  );

  // "גם בתוך ההודעות" (design 8ב): the search scope as one switch inside the
  // search box, in place of the two-way switch under it.
  const searchScope = (
    <Link
      prefetch={false}
      href={href({ filter, team: teamValue, q: query, inMessages: !inMessages, c: openKey })}
      aria-pressed={inMessages}
      className={`flex min-h-9 flex-none items-center whitespace-nowrap rounded-md border px-2 text-xs ${
        inMessages ? "border-navy bg-navy font-medium text-white" : "border-app-border-strong bg-app-surface-sunken text-app-text-primary"
      }`}
    >
      {t("list.inMessages")}
    </Link>
  );

  return (
    <div className="space-y-4">
      <RememberFilters filter={filter} team={teamValue} />
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">{t("page.title")}</h1>
          <p className="mt-0.5 hidden text-sm text-app-text-secondary sm:block">{t("page.subtitle")}</p>
          <div className="flex flex-wrap items-center gap-x-3">
            <Link prefetch={false} href="/app/whatsapp-poc/setup" className="inline-flex min-h-11 items-center text-sm text-app-text-primary underline">
              {t("page.setupLink")}
            </Link>
            {toReview > 0 ? (
              <Link
                prefetch={false}
                href="/app/whatsapp-poc/setup"
                className="inline-flex min-h-9 items-center rounded-full border border-app-warning bg-app-warning-soft px-3 text-[13px] font-medium text-app-warning"
              >
                {t("page.toReview", { count: toReview })}
              </Link>
            ) : null}
          </div>
        </div>
        {/* On a phone the box folds away, so the list starts near the top. */}
        <details className="w-full sm:hidden" open={badPhone || undefined}>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-app-text-primary underline">{t("page.openByNumber")}</summary>
          <form method="get" action={BASE} className="flex flex-wrap items-end gap-2 pb-2">
          <div>
            <label htmlFor="open-phone-m" className="block text-xs font-medium text-app-text-secondary">
              {t("page.openByNumber")}
            </label>
            <input
              id="open-phone-m"
              name="phone"
              type="tel"
              dir="ltr"
              defaultValue={searchParams.phone ?? ""}
              placeholder="050-0000000"
              className="mt-1 w-44 rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </div>
          <button type="submit" className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white">
            {t("page.open")}
          </button>
        </form>
        </details>
        <form method="get" action={BASE} className="hidden flex-wrap items-end gap-2 sm:flex">
          <div>
            <label htmlFor="open-phone" className="block text-xs font-medium text-app-text-secondary">
              {t("page.openByNumber")}
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
          <button type="submit" className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white">
            {t("page.open")}
          </button>
        </form>
      </header>

      {badPhone ? <Banner tone="error">{t("page.badPhone")}</Banner> : null}
      {waError ? <Banner tone="error">{t("page.waError", { error: waError })}</Banner> : null}
      {callsError ? <Banner tone="error">{t("page.callsError", { error: callsError })}</Banner> : null}
      {callsStale ? <Banner tone="info">{t("page.callsStale")}</Banner> : null}

      {callsTable ? (
        <section aria-label={t("filters.call")} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-full max-w-sm">{filterRow}</div>
            <p className="text-sm text-app-text-secondary">{t("calls.intro")}</p>
          </div>
          {!config.hasOpenAiKey ? <Banner tone="info">{t("calls.noTranscription")}</Banner> : null}
          <ul className="space-y-3">
            {calls.filter((call) => !team || lineOwnerOf(call.line) === team).map((call) => {
              const o = owners.get(call.other);
              const name = o?.personName ?? call.other;
              return (
                <li key={call.emailId} className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ChannelIcon channel="call" />
                      <div className="min-w-0">
                        <Link prefetch={false} href={href({ c: phoneKey(call.other), filter: "call", team: teamValue })} className="font-medium text-app-text-primary underline-offset-2 hover:underline">
                          <bdi>{name === call.other ? shownPhone(t, call.other) : shownName(t, name)}</bdi>
                        </Link>
                        <p className="text-xs text-app-text-secondary">
                          {call.direction !== "unknown" ? `${t(`calls.directionShort.${call.direction}`)} · ` : ""}
                          {formatDateTime(format, call.callAt)}
                          {callMeta(t, call)}
                        </p>
                        {o?.personName ? (
                          <p dir="ltr" className="text-end text-xs text-app-text-secondary">
                            {shownPhone(t, call.other)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {o && o.clients.length > 0 ? (
                        <ClientTag clients={o.clients} />
                      ) : (
                        <Link prefetch={false}
                          href={href({ c: phoneKey(call.other), filter: "call", team: teamValue, assign: true })}
                          className="inline-flex min-h-11 items-center rounded-full border border-dashed border-app-warning px-3 text-xs text-app-warning"
                        >
                          {t("calls.assign")}
                        </Link>
                      )}
                      <CallTaskButton
                        call={call}
                        ctx={{
                          contactName: o?.personName ?? "",
                          phone: call.other,
                          clients: clientOptions,
                          defaultClientId: o?.clients.length === 1 ? o.clients[0].id : null,
                        }}
                      />
                    </div>
                  </div>
                  {call.audioRemoved ? (
                    <p className="text-sm text-app-text-secondary">{t("calls.audioRemoved")}</p>
                  ) : (
                    <RecordingPlayer src={recordingHref(call.emailId)} />
                  )}
                  <CallTranscript call={call} canTranscribe={config.hasOpenAiKey} />
                </li>
              );
            })}
            {calls.length === 0 && !callsError ? <li className="text-sm text-app-text-secondary">{t("calls.empty")}</li> : null}
          </ul>
        </section>
      ) : (
        <div className="comms-grid grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_auto]">
          {/* The list. On a phone it gives way to the open conversation. */}
          <nav
            aria-label={t("list.aria")}
            className={`${isOpen ? "hidden lg:flex" : "flex"} max-h-[78vh] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-app-border bg-white`}
          >
            <div className="space-y-3 border-b border-app-border p-3">
              <form method="get" action={BASE} className="flex gap-2">
                <input type="hidden" name="filter" value={filter} />
                <input type="hidden" name="team" value={teamValue} />
                {inMessages ? <input type="hidden" name="in" value="msg" /> : null}
                <label htmlFor="inbox-q" className="sr-only">
                  {t("list.search")}
                </label>
                <div className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-app-border-strong bg-white pe-1 focus-within:border-gold">
                  <input
                    id="inbox-q"
                    name="q"
                    type="search"
                    defaultValue={query}
                    placeholder={inMessages ? t("list.placeholderMessages") : t("list.placeholder")}
                    className="min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2 text-sm text-app-text-primary outline-none"
                  />
                  {searchScope}
                </div>
                <button type="submit" aria-label={t("list.search")} className="flex size-11 flex-none items-center justify-center rounded-lg border border-app-border-strong text-app-text-primary">
                  <Search className="size-4" aria-hidden="true" />
                </button>
              </form>
              {filterRow}
            </div>
            {inMessages ? (
              <ul className="flex-1 divide-y divide-app-border overflow-y-auto">
                <li className="px-3 py-2 text-xs text-app-text-secondary">
                  {query.trim().length < 2
                    ? t("list.minChars")
                    : t("list.hitsNote", { found: hits.length >= 40 ? t("list.hitsLast40") : t("list.hits", { count: hits.length }) })}
                </li>
                {hits.map((h) => {
                  const part = snippetAround(h.text, query);
                  const key = keyOfChat(h.chatId, h.channelId);
                  const name = rows.find((r) => r.key === key)?.name ?? h.name;
                  return (
                    <li key={`${h.channelId}-${h.messageId}`}>
                      <Link
                        prefetch={false}
                        href={href({
                          c: key,
                          filter,
                          team: teamValue,
                          q: query,
                          inMessages: true,
                          m: h.messageId,
                          // The found message is the newest one loaded, so it is in view.
                          before: new Date(Date.parse(h.at) + 1000).toISOString(),
                        })}
                        aria-current={hitId === h.messageId ? "page" : undefined}
                        data-inbox-row=""
                        className={`flex flex-col gap-1 px-3 py-3 ${hitId === h.messageId ? "bg-app-accent-soft" : "hover:bg-app-surface-sunken"}`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[15px] font-medium text-app-text-primary"><bdi>{shownName(t, name)}</bdi></span>
                          <span className="flex flex-none items-center gap-1.5">
                            <RowPending />
                            <span className="text-xs text-app-text-secondary">{formatListTime(format, t, h.at, now)}</span>
                          </span>
                        </span>
                        <span dir="auto" className="line-clamp-2 text-[13px] text-app-text-primary">
                          {h.isSender ? `${t("list.we")} ` : ""}
                          {part.before}
                          <mark className="rounded bg-gold/30 px-0.5 text-inherit">{part.match}</mark>
                          {part.after}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
            <ul className="flex-1 divide-y divide-app-border overflow-y-auto">
              {visible.map((row) => {
                const active = row.key === openKey;
                const unread = isUnread(row);
                const targets = readTargets(row.chats);
                return (
                  <li key={row.key} className="group relative">
                    <Link prefetch={false}
                      href={href({ c: row.key, filter, team: teamValue, q: query })}
                      aria-current={active ? "page" : undefined}
                      data-inbox-row=""
                      className={`flex gap-3 px-3 py-3 ${targets.length > 0 ? "pe-16" : ""} ${active ? "bg-app-accent-soft" : "hover:bg-app-surface-sunken"}`}
                    >
                      <ChannelIcon channel={row.channel} />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`truncate text-[15px] text-app-text-primary ${unread ? "font-semibold" : "font-medium"}`}><bdi>{shownName(t, row.name)}</bdi></span>
                          <span className="flex flex-none items-center gap-1.5">
                            <RowPending />
                            <span className={`text-xs ${unread ? "font-medium text-app-text-accent" : "text-app-text-secondary"}`}>{formatListTime(format, t, row.at, now)}</span>
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span dir="auto" className={`truncate text-[13px] ${unread ? "text-app-text-primary" : "text-app-text-secondary"}`}>
                            {row.previewKind ? t(`preview.${row.previewKind}`) : row.preview}
                          </span>
                          {row.unreadCount > 0 ? (
                            <span className="flex-none rounded-full bg-gold px-2 text-xs text-white">{row.unreadCount}</span>
                          ) : unread ? (
                            <span role="img" aria-label={t("list.markedUnread")} className="size-2.5 flex-none rounded-full bg-gold" />
                          ) : null}
                        </span>
                        {row.phone ? <ClientTag clients={row.clients} /> : null}
                      </span>
                    </Link>
                    {/* "סמן כנקראה / כלא נקראה" on the row (design 7): shown on hover or focus
                        with a mouse, always on a touch screen. */}
                    {targets.length > 0 ? (
                      <div className="absolute end-2 top-1/2 -translate-y-1/2 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                        <ReadToggle compact chats={targets} unread={unread} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {visible.length === 0 ? (
                <li className="p-4 text-sm text-app-text-secondary">
                  {filter === "wa" && waError
                    ? t("list.waUnavailable")
                    : query || filter !== "all"
                      ? t("list.noResults")
                      : t("list.empty")}
                </li>
              ) : null}
            </ul>
            )}
            <ScrollToActive />
          </nav>

          {/* The timeline of the open contact. */}
          <section
            aria-label={t("timeline.aria")}
            className={`${isOpen ? "flex" : "hidden lg:flex"} relative h-[78vh] min-h-[24rem] flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface-page`}
          >
            {/* While a row's conversation loads (RowPending in that row). */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-30 hidden items-center justify-center bg-app-surface-page/70 [.comms-grid:has([data-nav-pending])_&]:flex"
            >
              <span className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-app-text-secondary shadow">
                <span className="size-4 animate-spin rounded-full border-2 border-app-border-strong border-t-navy" />
                {t("timeline.loading")}
              </span>
            </div>
            {isOpen ? (
              <MessageSelectionProvider
                key={`select-${openKey}`}
                chatId={chat?.id ?? ""}
                numberKey={messages[0]?.numberKey ?? ""}
                contactName={contactName}
                phone={selectedPhone}
                clients={clientOptions}
                defaultClientId={owner?.clients.length === 1 ? owner.clients[0].id : null}
                proposedTitle={proposeSelectedTitle(contactName, selectedPhone)}
              >
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border bg-white px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link prefetch={false}
                      href={href({ filter, team: teamValue, q: query, inMessages })}
                      aria-label={t("timeline.back")}
                      className="flex size-11 flex-none items-center justify-center rounded-lg text-app-text-primary lg:hidden"
                    >
                      <ArrowRight className="size-5 ltr:rotate-180" aria-hidden="true" />
                    </Link>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-medium text-app-text-primary">
                        <bdi>{shownName(t, contactName)}</bdi>
                      </h2>
                      {selectedPhone ? (
                        <p dir="ltr" className="text-end text-xs text-app-text-secondary">
                          {shownPhone(t, selectedPhone)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {owner?.clients.map((c) => (
                      <Link prefetch={false}
                        key={c.id}
                        href={`/app/clients/${c.id}`}
                        className="inline-flex min-h-9 items-center rounded-lg bg-app-accent-soft px-3 text-[13px] font-medium text-app-text-accent"
                      >
                        {t("timeline.client", { name: c.name })}
                      </Link>
                    ))}
                    {/* "סמן כנקראה" (design 7): only on a click, never on opening. */}
                    {openTargets.length > 0 ? (
                      <ReadToggle key={`read-${openKey}-${openUnread}`} chats={openTargets} unread={openUnread} />
                    ) : null}
                    {/* "סמן הודעות" (4.11.2026): several messages into one task. */}
                    {chat && messages.length > 0 ? <SelectModeButton /> : null}
                    {/* Keyed by the open contact: a form that stayed mounted kept the
                        previous contact's title and details (Ariel, 1.11.2026). */}
                    {/* Hidden while marking: two task forms side by side read as one, and
                        this one proposes the latest messages, not the marked ones (Ariel, 4.11.2026). */}
                    <HideWhileSelecting>
                      <TaskFromConversation
                        key={`task-${openKey}`}
                        clients={clientOptions}
                        defaultClientId={owner?.clients.length === 1 ? owner.clients[0].id : null}
                        title={proposal.title}
                        description={proposal.description}
                      />
                    </HideWhileSelecting>
                    {/* "לא לשמור שיחות עם המספר" (design 3א): rare, so in "עוד", last, in red. */}
                    {chatInfo?.id && chat ? (
                      <details className="relative">
                        <summary
                          aria-label={t("timeline.moreActions")}
                          className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg border border-app-border-strong bg-white text-app-text-primary"
                        >
                          <MoreHorizontal className="size-5" aria-hidden="true" />
                        </summary>
                        <div className="absolute end-0 z-20 mt-1 w-72 rounded-xl border border-app-border bg-white py-1 shadow-lg">
                          <BlockButton
                            key={`block-${openKey}`}
                            channelId={chatInfo.id}
                            kind={selectedPhone ? "PHONE" : "CHAT"}
                            value={selectedPhone ?? chat.id}
                            label={contactName}
                            manager={access.manager}
                            asMenuItem
                          />
                        </div>
                      </details>
                    ) : null}
                  </div>
                </header>

                <div className="relative flex min-h-0 flex-1 flex-col">
                <ol id="comms-timeline" className="flex-1 space-y-3 overflow-y-auto p-4 sm:px-6">
                  {/* Oldest first (5.11.2026), so the way back to older messages sits at the top. */}
                  {loaded.hasOlder && messages[0] ? (
                    <li className="flex justify-center">
                      <Link
                        prefetch={false}
                        href={href({ c: openKey, filter, team: teamValue, q: query, inMessages, before: messages[0].timestamp })}
                        className="inline-flex min-h-11 items-center text-sm text-app-text-primary underline"
                      >
                        {t("timeline.older")}
                      </Link>
                    </li>
                  ) : null}

                  {timeline.map((item, i) => {
                    const prev = timeline[i - 1];
                    const newDay = !prev || dayKey(prev.at) !== dayKey(item.at);
                    const day = newDay ? (
                      <li key={`d-${item.at}`} className="flex justify-center">
                        <span className="rounded-full bg-app-surface-sunken px-3 py-1 text-xs text-app-text-secondary">{formatDay(format, item.at)}</span>
                      </li>
                    ) : null;
                    if (item.kind === "message") {
                      const m = messageById.get(item.id);
                      return m && chat ? [day, <MessageBubble
                            key={`m-${m.id}`}
                            m={m}
                            chat={chat}
                            transcript={voiceTranscripts.get(m.id)}
                            hit={m.id === hitId}
                            quoted={m.quoted ? messageById.get(m.quoted.id) : undefined}
                          />] : day;
                    }
                    const call = callById.get(item.id);
                    return call ? [day, <CallCard
                          key={`c-${call.emailId}`}
                          call={call}
                          transcribe={config.hasOpenAiKey}
                          task={{
                            contactName,
                            phone: selectedPhone,
                            clients: clientOptions,
                            defaultClientId: owner?.clients.length === 1 ? owner.clients[0].id : null,
                          }}
                        />] : day;
                  })}
                  {timeline.length === 0 ? <li className="text-sm text-app-text-secondary">{t("timeline.empty")}</li> : null}
                  {beforeParam ? (
                    <li className="flex justify-center">
                      <Link prefetch={false} href={href({ c: openKey, filter, team: teamValue, q: query, inMessages })} className="inline-flex min-h-11 items-center text-sm text-app-text-primary underline">
                        {t("timeline.latest")}
                      </Link>
                    </li>
                  ) : null}
                </ol>
                <TimelineScroller key={`scroll-${openKey}-${hitId ?? ""}-${beforeParam?.toISOString() ?? ""}-${timeline.length}`} targetId="comms-timeline" />
                </div>

                {chat ? (
                  mayReply ? (
                    <div className="bg-white">
                      <SendForm key={`send-${chat.id}`} chatId={chat.id} channelId={replyAs?.id ?? ""} group={chat.type === "group"} />
                    </div>
                  ) : (
                    <p className="border-t border-app-border bg-white p-4 text-xs text-app-text-secondary">
                      {noReplyReason}
                    </p>
                  )
                ) : selectedPhone && waReady ? (
                  <div className="border-t border-app-border bg-white p-4 text-sm text-app-text-secondary">
                    {lookedUp && waError ? (
                      t("timeline.lookupFailed", { error: waError })
                    ) : lookedUp ? (
                      t("timeline.notFound")
                    ) : (
                      <Link prefetch={false} href={href({ c: phoneKey(selectedPhone), filter, team: teamValue, q: query, wa: true })} className="inline-flex min-h-11 items-center text-app-text-primary underline">
                        {t("timeline.lookup")}
                      </Link>
                    )}
                  </div>
                ) : null}
              </MessageSelectionProvider>
            ) : (
              <p className="m-auto p-6 text-sm text-app-text-secondary">{t("timeline.pick")}</p>
            )}
          </section>

          {/* The contact, from the client files. */}
          {isOpen ? (
            <ContactRail unassigned={Boolean(selectedPhone) && !(owner && owner.clients.length > 0)} messages={countSince(messages, (m) => m.timestamp, since30)}>
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-app-text-secondary">{t("rail.contact")}</h3>
                <p className="font-medium text-app-text-primary">
                  <bdi>{shownName(t, contactName)}</bdi>
                </p>
                {owner && owner.clients.length > 0 ? (
                  <ul className="space-y-1">
                    {owner.clients.map((c) => (
                      <li key={c.id}>
                        <Link prefetch={false} href={`/app/clients/${c.id}`} className="inline-flex min-h-9 items-center text-sm text-app-text-accent underline">
                          {t("rail.toClientFile", { name: c.name })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : selectedPhone ? (
                  <p className="text-sm text-app-text-secondary">{t("rail.notInFile")}</p>
                ) : null}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-medium text-app-text-secondary">{t("rail.last30")}</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-app-surface-sunken p-2.5">
                    <p className="text-xl font-medium text-app-text-primary">{countSince(messages, (m) => m.timestamp, since30)}</p>
                    <p className="text-xs text-app-text-secondary">{t("rail.messages")}</p>
                  </div>
                  <div className="rounded-lg bg-app-surface-sunken p-2.5">
                    <p className="text-xl font-medium text-app-text-primary">{countSince(contactCalls, (c) => c.callAt, since30)}</p>
                    <p className="text-xs text-app-text-secondary">{t("rail.calls")}</p>
                  </div>
                </div>
                <p className="text-xs text-app-text-tertiary">
                  {chat ? `${t("rail.messagesLoaded")} ` : waError ? `${t("rail.messagesNotCounted")} ` : ""}
                  {stored.length > 0 ? t("rail.callsStored") : t("rail.callsLoaded")}
                </p>
              </section>

              {chat && chat.type === "group" && chatInfo?.id && openChats[0] && isStored(wa, openChats[0]) ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium text-app-text-secondary">{t("rail.groupClient")}</h3>
                  <GroupClientForm
                    key={`group-${openKey}`}
                    channelId={chatInfo.id}
                    chatId={chat.id}
                    current={chat.groupClient?.id ?? ""}
                    clients={clientOptions}
                  />
                </section>
              ) : null}

              {selectedPhone ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium text-app-text-secondary">{t("rail.knownNumbers")}</h3>
                  <ul dir="ltr" className="space-y-0.5 text-end text-sm text-app-text-primary">
                    {(owner?.phones.length ? owner.phones : [selectedPhone]).map((p) => (
                      <li key={p}>{shownPhone(t, p)}</li>
                    ))}
                  </ul>
                  {config.lineNumbers.includes(selectedPhone) ? (
                    <p className="text-xs text-app-text-secondary">
                      {t("rail.ankoraLine")}
                    </p>
                  ) : owner && owner.contacts.length > 0 ? (
                    <AddNumberForm key={`add-${openKey}`} contactId={owner.contacts[0].id} />
                  ) : !isPlausiblePhone(selectedPhone) ? (
                    <p className="text-xs text-app-text-secondary">{t("rail.whatsappId")}</p>
                  ) : (
                    <AssignToClientForm
                      key={`assign-${openKey}`}
                      phone={selectedPhone}
                      defaultName={chat?.name && chat.name !== NO_NAME ? chat.name : ""}
                      clients={clientOptions}
                      defaultOpen={searchParams.assign === "1"}
                    />
                  )}
                </section>
              ) : null}
            </ContactRail>
          ) : null}
        </div>
      )}
    </div>
  );
}

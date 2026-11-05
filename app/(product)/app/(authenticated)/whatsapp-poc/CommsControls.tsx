"use client";
import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLinkStatus } from "next/link";
import { ArrowDown, BarChart3, Link2, Loader2, Mail, MailOpen, User, X } from "lucide-react";
import { markChatsReadAction } from "./actions";

// The communications screen's small client pieces (5.11.2026, Ariel's
// review of the designs on Claude Design).

const RAIL_KEY = "comms.contactRail";
const RAIL_EVENT = "comms.contactRail";
let railFallback: boolean | null = null;

function readRail(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === "open";
  } catch {
    return false;
  }
}

function subscribeRail(onChange: () => void) {
  window.addEventListener(RAIL_EVENT, onChange);
  return () => window.removeEventListener(RAIL_EVENT, onChange);
}

/// The contact's card as a narrow column of icons on a wide screen, opened
/// on a click (design 1ב): the card took width the conversation needs. On a
/// narrower screen the card sits under the conversation, open, as before.
/// Open or closed is kept per browser.
export function ContactRail(props: { unassigned: boolean; messages: number; children: ReactNode }) {
  const open = useSyncExternalStore(subscribeRail, () => railFallback ?? readRail(), () => false);
  const toggle = (next: boolean) => {
    try {
      window.localStorage.setItem(RAIL_KEY, next ? "open" : "closed");
      railFallback = null;
    } catch {
      // Storage refused: the choice holds until the page reloads.
      railFallback = next;
    }
    window.dispatchEvent(new Event(RAIL_EVENT));
  };
  const icon = "flex size-11 items-center justify-center rounded-xl text-app-text-primary hover:bg-app-surface-sunken";
  return (
    <aside
      aria-label="איש קשר"
      className={`rounded-2xl border border-app-border bg-white lg:col-span-2 xl:col-span-1 ${open ? "xl:w-[17rem]" : "xl:w-16"}`}
    >
      {/* Closed, wide screens only: the icons. */}
      <div className={`${open ? "hidden" : "hidden xl:flex"} flex-col items-center gap-1 py-3`}>
        <button type="button" onClick={() => toggle(true)} aria-label="פתיחת פרטי איש הקשר" aria-expanded={false} className={`${icon} bg-app-surface-sunken`}>
          <User className="size-5" aria-hidden="true" />
        </button>
        <span className="text-[11px] text-app-text-secondary">איש קשר</span>
        <button type="button" onClick={() => toggle(true)} aria-label={props.unassigned ? "שיוך ללקוח: המספר לא משויך" : "הלקוח של המספר"} className={`relative mt-2 ${icon}`}>
          <Link2 className="size-5" aria-hidden="true" />
          {props.unassigned ? <span aria-hidden="true" className="absolute start-2 top-2 size-2 rounded-full bg-app-warning" /> : null}
        </button>
        <span className="text-[11px] text-app-text-secondary">שיוך</span>
        <button type="button" onClick={() => toggle(true)} aria-label="פעילות ב-30 הימים האחרונים" className={`mt-2 ${icon}`}>
          <BarChart3 className="size-5" aria-hidden="true" />
        </button>
        <span className="text-center text-[11px] text-app-text-secondary">{props.messages} הודעות</span>
      </div>
      {/* Open (or any narrower screen): the whole card. */}
      <div className={`${open ? "block" : "xl:hidden"} space-y-5 p-4`}>
        <div className="hidden justify-end xl:flex">
          <button type="button" onClick={() => toggle(false)} aria-label="סגירת פרטי איש הקשר" className="flex size-9 items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-surface-sunken">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {props.children}
      </div>
    </aside>
  );
}

/// Remembers the list's last filters (5.11.2026, Ariel): the next visit to
/// the screen opens with them.
export function RememberFilters({ filter, team }: { filter: string; team: string }) {
  useEffect(() => {
    const value = encodeURIComponent(JSON.stringify({ filter, team }));
    document.cookie = `comms_filters=${value}; path=/app/whatsapp-poc; max-age=31536000; samesite=lax`;
  }, [filter, team]);
  return null;
}

/// The timeline scrolls inside its box, oldest at the top, as WhatsApp
/// reads (design 5א). It opens at the latest message, or at the message a
/// search found; a button brings the latest back after scrolling up.
export function TimelineScroller({ targetId }: { targetId: string }) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const box = document.getElementById(targetId);
    if (!box) return;
    const hit = box.querySelector<HTMLElement>("[data-hit]");
    if (hit) hit.scrollIntoView({ block: "center" });
    else box.scrollTop = box.scrollHeight;
    const onScroll = () => setAway(box.scrollHeight - box.scrollTop - box.clientHeight > 240);
    onScroll();
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, [targetId]);
  if (!away) return null;
  return (
    <button
      type="button"
      aria-label="קפיצה להודעה האחרונה"
      onClick={() => {
        const box = document.getElementById(targetId);
        box?.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
      }}
      className="absolute bottom-3 start-1/2 z-10 flex size-11 -translate-x-1/2 items-center justify-center rounded-full border border-app-border bg-white text-app-text-primary shadow-md rtl:translate-x-1/2"
    >
      <ArrowDown className="size-5" aria-hidden="true" />
    </button>
  );
}

/// "סמן כנקראה" / "סמן כלא נקראה" (design 7, the two together): in the
/// conversation's header with its label, and as an icon on a list row.
/// Only on a click; opening a chat never marks it.
export function ReadToggle(props: { chats: Array<{ chatId: string; numberKey: string }>; unread: boolean; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = props.unread ? "סמן כנקראה" : "סמן כלא נקראה";
  const Icon = props.unread ? MailOpen : Mail;
  const run = () =>
    start(async () => {
      setError(null);
      const result = await markChatsReadAction({ chats: props.chats, read: props.unread });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  if (props.compact) {
    return (
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-label={error ? `${label}: ${error}` : label}
        title={error ?? label}
        className={`flex size-11 items-center justify-center rounded-lg border bg-white text-app-text-primary disabled:opacity-60 ${
          error ? "border-app-error" : "border-app-border-strong"
        }`}
      >
        <Icon className="size-[18px]" aria-hidden="true" />
      </button>
    );
  }
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={`flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-sm disabled:opacity-60 ${
          props.unread ? "border-navy bg-navy text-white" : "border-app-border-strong bg-white text-app-text-primary"
        }`}
      >
        <Icon className="size-4" aria-hidden="true" />
        {pending ? "מסמן..." : label}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-app-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/// Inside a list row's link (5.11.2026, Ariel: a click showed nothing for
/// seconds and felt stuck). While the conversation loads, the row shows a
/// spinner, and `data-nav-pending` lets the timeline beside it show that it
/// is loading (the `comms-grid` rule in page.tsx).
export function RowPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span data-nav-pending="" role="status" aria-label="טוען את השיחה" className="flex flex-none items-center">
      <Loader2 className="size-4 animate-spin text-app-text-secondary" aria-hidden="true" />
    </span>
  );
}

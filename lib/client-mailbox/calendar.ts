import "server-only";
import type { User } from "@prisma/client";
import { DomainError } from "@/lib/domain-error";
import { guarded, resolveMailbox, timeFilter, used, type MailboxNeed, type MailboxRow } from "./mailbox";
import {
  capabilitiesOf,
  isMailProvider,
  readMailAccount,
  createCalendar,
  createEvent,
  deleteCalendar,
  eventAction,
  getEvent,
  listCalendars,
  listEvents,
  updateCalendar,
  updateEvent,
  type EventChange,
  type EventTime,
} from "./unipile-mail";
import { calendarOf, eventOf } from "./shape";

// A client's calendar through the connector (stage 2, 26.11.2026): the
// calendar of the same Google or Microsoft account as the mailbox, with the
// same rules (lib/client-mailbox/mailbox.ts). An IMAP mailbox has none.
//
// Times Claude passes are Israel time unless they say otherwise: a local
// "2026-11-30T14:00" goes to the provider with Asia/Jerusalem, as the person
// asking means it. Guests are not notified unless the call says so, because
// an invitation is a message the client sends.

const ZONE = "Asia/Jerusalem";

async function calendarMailbox(actor: User, clientId: string | null, mailbox: string | undefined, need: MailboxNeed) {
  const row = await resolveMailbox(actor, clientId, mailbox, need);
  // A personal mailbox records no capabilities: the provider says.
  const scopes = row.source === "personal" ? await guarded(row, () => readMailAccount(row.unipileAccountId)).then((a) => (isMailProvider(a.provider) ? capabilitiesOf(a.provider) : ["mail"])) : row.scopes;
  if (!scopes.includes("calendar")) {
    throw new DomainError("connections.mailbox.noCalendar", `לתיבה ${row.account} אין יומן דרך החיבור (תיבה בפרוטוקול IMAP). יומן יש רק בחשבון Google או Microsoft.`, { account: row.account });
  }
  return row;
}

/// The calendar to use: the one named, or the mailbox's default one.
async function pickCalendar(row: MailboxRow, calendarId?: string): Promise<string> {
  if (calendarId) return calendarId;
  const calendars = await guarded(row, () => listCalendars(row.unipileAccountId));
  const main = calendars.find((c) => c.is_default === true) ?? calendars[0];
  const id = typeof main?.id === "string" ? main.id : null;
  if (!id) throw new DomainError("connections.mailbox.noCalendarFound", "לא נמצא יומן בחשבון הזה.");
  return id;
}

/// "2026-11-30" (all day) or "2026-11-30T14:00" / "2026-11-30 14:00" (Israel
/// time unless an offset or `timezone` says otherwise).
export function eventTime(value: string, timezone?: string): EventTime {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { type: "date", date: v };
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?(.*)$/);
  if (!m) throw new DomainError("connections.mailbox.badDate", `התאריך ${v} לא תקין. כותבים YYYY-MM-DD.`, { value: v });
  const offset = m[4].trim();
  const dateTime = `${m[1]}T${m[2]}${m[3] ?? ":00"}${offset}`;
  return offset ? { type: "datetime", date_time: dateTime } : { type: "datetime", date_time: dateTime, timezone: timezone || ZONE };
}

export async function listClientCalendar(
  actor: User,
  clientId: string | null,
  input: {
    mailbox?: string;
    calendarId?: string;
    eventId?: string;
    calendarsOnly?: boolean;
    from?: string;
    to?: string;
    text?: string;
    attendee?: string;
    location?: string;
    busyOnly?: boolean;
    includeCancelled?: boolean;
    expandRecurring?: boolean;
    cursor?: string;
    limit?: number;
  },
) {
  const row = await calendarMailbox(actor, clientId, input.mailbox, "read");
  if (input.calendarsOnly) {
    const calendars = await guarded(row, () => listCalendars(row.unipileAccountId));
    await used(actor, row, "calendars", { count: calendars.length }, "calendar_read");
    return { mailbox: row.account, calendars: calendars.map(calendarOf).filter(Boolean) };
  }
  const calendarId = await pickCalendar(row, input.calendarId);
  if (input.eventId) {
    const event = await guarded(row, () => getEvent(row.unipileAccountId, calendarId, input.eventId!));
    await used(actor, row, "event", { calendarId, eventId: input.eventId }, "calendar_read");
    return { mailbox: row.account, calendarId, event: eventOf(event, { withBody: true }) };
  }
  const page = await guarded(row, () =>
    listEvents(row.unipileAccountId, calendarId, {
      start: timeFilter(input.from, "start"),
      end: timeFilter(input.to, "end"),
      title: input.text?.trim() || undefined,
      attendees: input.attendee?.trim() || undefined,
      location: input.location?.trim() || undefined,
      busy: input.busyOnly,
      is_cancelled: input.includeCancelled,
      expand_recurring: input.expandRecurring ?? true,
      cursor: input.cursor || undefined,
      limit: Math.min(Math.max(input.limit ?? 50, 1), 100),
    }),
  );
  await used(actor, row, "events", { calendarId, count: page.items.length }, "calendar_read");
  return { mailbox: row.account, calendarId, events: page.items.map((e) => eventOf(e)).filter(Boolean), nextCursor: page.nextCursor };
}

export type EventInput = {
  mailbox?: string;
  calendarId?: string;
  eventId?: string;
  title?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  timezone?: string;
  attendees?: string[];
  optionalAttendees?: string[];
  recurrence?: string[];
  videoCall?: "google_meet" | "teams" | "zoom";
  videoCallUrl?: string;
  busy?: boolean;
  private?: boolean;
  hideAttendees?: boolean;
  notifyGuests?: "all" | "external_only" | "none";
};

export async function saveClientEvent(actor: User, clientId: string | null, input: EventInput) {
  const row = await calendarMailbox(actor, clientId, input.mailbox, "write");
  const calendarId = await pickCalendar(row, input.calendarId);
  const change: EventChange = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { body: input.description } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.start ? { start: eventTime(input.start, input.timezone) } : {}),
    ...(input.end ? { end: eventTime(input.end, input.timezone) } : {}),
    ...(input.recurrence ? { recurrence: input.recurrence } : {}),
    ...(input.busy !== undefined ? { transparency: input.busy ? ("opaque" as const) : ("transparent" as const) } : {}),
    ...(input.private !== undefined ? { visibility: input.private ? ("private" as const) : ("public" as const) } : {}),
    ...(input.hideAttendees !== undefined ? { is_attendees_list_hidden: input.hideAttendees } : {}),
    ...(input.videoCall || input.videoCallUrl ? { conference: { provider: input.videoCall ?? "unknown", ...(input.videoCallUrl ? { url: input.videoCallUrl } : {}) } } : {}),
    notify: input.notifyGuests === "all" ? "all" : input.notifyGuests === "external_only" ? "externalOnly" : "none",
  };
  if (input.attendees || input.optionalAttendees) {
    change.attendees = [
      ...(input.attendees ?? []).map((email) => ({ email: email.trim(), type: "required" as const })),
      ...(input.optionalAttendees ?? []).map((email) => ({ email: email.trim(), type: "optional" as const })),
    ];
  }
  let saved;
  if (input.eventId) {
    saved = await guarded(row, () => updateEvent(row.unipileAccountId, calendarId, input.eventId!, change));
  } else {
    if (!input.title?.trim() || !input.start || !input.end) {
      throw new DomainError("connections.mailbox.eventFieldsRequired", "לאירוע חדש צריך כותרת (title), התחלה (start) וסוף (end).");
    }
    saved = await guarded(row, () => createEvent(row.unipileAccountId, calendarId, { attendees: [], ...change }));
  }
  const event = eventOf(saved, { withBody: true });
  await used(
    actor,
    row,
    input.eventId ? "event_update" : "event_create",
    { calendarId, eventId: event?.id ?? input.eventId ?? null, attendees: (change.attendees ?? []).map((a) => a.email.toLowerCase()), notify: change.notify },
    "calendar_write",
  );
  return { mailbox: row.account, calendarId, event, guestsNotified: change.notify !== "none" };
}

export async function respondClientEvent(
  actor: User,
  clientId: string | null,
  input: { mailbox?: string; calendarId?: string; eventId: string; action: "accept" | "maybe" | "decline" | "cancel" | "restore" | "delete"; comment?: string },
) {
  const row = await calendarMailbox(actor, clientId, input.mailbox, "write");
  const calendarId = await pickCalendar(row, input.calendarId);
  const action =
    input.action === "accept"
      ? { kind: "rsvp" as const, status: "yes" as const, comment: input.comment }
      : input.action === "maybe"
        ? { kind: "rsvp" as const, status: "maybe" as const, comment: input.comment }
        : input.action === "decline"
          ? { kind: "rsvp" as const, status: "no" as const, comment: input.comment }
          : input.action === "cancel"
            ? { kind: "cancel" as const, comment: input.comment }
            : input.action === "restore"
              ? { kind: "restore" as const }
              : { kind: "delete" as const };
  await guarded(row, () => eventAction(row.unipileAccountId, calendarId, input.eventId, action));
  await used(actor, row, `event_${input.action}`, { calendarId, eventId: input.eventId }, "calendar_write");
  return { mailbox: row.account, calendarId, eventId: input.eventId, done: input.action };
}

export async function manageClientCalendars(
  actor: User,
  clientId: string | null,
  input: { mailbox?: string; action: "create" | "update" | "delete"; calendarId?: string; name?: string; description?: string; timezone?: string; color?: string },
) {
  const row = await calendarMailbox(actor, clientId, input.mailbox, "write");
  const change = {
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.timezone ? { timezone: input.timezone } : {}),
    ...(input.color ? { background_color: input.color } : {}),
  };
  let result: Record<string, unknown>;
  if (input.action === "create") {
    if (!change.name) throw new DomainError("connections.mailbox.nameRequired", "מעבירים שם ב-name.");
    result = { calendar: calendarOf(await guarded(row, () => createCalendar(row.unipileAccountId, { timezone: ZONE, ...change, name: change.name! }))) };
  } else {
    if (!input.calendarId) throw new DomainError("connections.mailbox.calendarIdRequired", "מעבירים את מזהה היומן ב-calendarId (מ-list_client_calendar_events עם calendarsOnly).");
    if (input.action === "update") result = { calendar: calendarOf(await guarded(row, () => updateCalendar(row.unipileAccountId, input.calendarId!, change))) };
    else {
      await guarded(row, () => deleteCalendar(row.unipileAccountId, input.calendarId!));
      result = { deleted: input.calendarId };
    }
  }
  await used(actor, row, `calendar_${input.action}`, { calendarId: input.calendarId ?? null, name: input.name ?? null }, "calendar_write");
  return { mailbox: row.account, action: input.action, ...result };
}

"use client";
import { useActionState, useRef, useState, useTransition } from "react";
import {
  addNumberToContactAction,
  assignGroupToClientAction,
  assignNumberToClientAction,
  listClientPeopleForAssignAction,
  type ClientPersonOption,
  type ContactState,
} from "./actions";

const input = "mt-1 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";
const label = "block text-xs font-medium text-app-text-secondary";

/// "שיוך ללקוח": a number that is in no client's file.
function CancelButton({ target }: { target: React.RefObject<HTMLDetailsElement | null> }) {
  return (
    <button
      type="button"
      onClick={() => target.current?.removeAttribute("open")}
      className="min-h-11 rounded-lg border border-app-border-strong px-4 text-sm text-app-text-primary"
    >
      ביטול
    </button>
  );
}

export function AssignToClientForm(props: {
  phone: string;
  defaultName: string;
  clients: Array<{ id: string; name: string }>;
  defaultOpen?: boolean;
}) {
  const [state, action, pending] = useActionState<ContactState | undefined, FormData>(assignNumberToClientAction, undefined);
  const ref = useRef<HTMLDetailsElement>(null);
  // 5.11.2026: after the client, who in its file this number belongs to.
  // Someone already there gets the number added; "אדם חדש" adds a person.
  const [clientId, setClientId] = useState("");
  const [people, setPeople] = useState<ClientPersonOption[] | null>(null);
  const [contactId, setContactId] = useState("");
  const [loading, startLoading] = useTransition();
  const pickClient = (id: string) => {
    setClientId(id);
    setPeople(null);
    setContactId("");
    if (!id) return;
    startLoading(async () => {
      const list = await listClientPeopleForAssignAction(id);
      setPeople(list);
      // The WhatsApp name, when it is a person's name in the file.
      const wanted = props.defaultName.trim().toLowerCase();
      const same = wanted ? list.find((p) => p.name.toLowerCase().split(",")[0].trim() === wanted) : undefined;
      if (same) setContactId(same.contactId);
    });
  };
  if (state?.ok) {
    return <p className="text-sm text-app-success">{contactId ? "המספר נוסף לאיש הקשר בתיק הלקוח." : "נשמר בתיק הלקוח, מסומן כלא ודאי עד אישור."}</p>;
  }
  const isNew = contactId === "";
  return (
    <details ref={ref} open={props.defaultOpen || undefined} className="rounded-lg border border-dashed border-app-border-strong">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-app-text-primary">שיוך ללקוח</summary>
      <form action={action} className="space-y-3 px-3 pb-3">
        <input type="hidden" name="phone" value={props.phone} />
        <div>
          <label htmlFor="assign-client" className={label}>
            לקוח
          </label>
          <select id="assign-client" name="clientId" required className={input} value={clientId} onChange={(e) => pickClient(e.target.value)}>
            <option value="" disabled>
              בחירת לקוח
            </option>
            {props.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {clientId ? (
          <div>
            <label htmlFor="assign-person" className={label}>
              של מי המספר
            </label>
            <select
              id="assign-person"
              name="contactId"
              className={input}
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              disabled={loading || people === null}
            >
              {loading || people === null ? <option value="">טוען את האנשים בתיק...</option> : null}
              {(people ?? []).map((p) => (
                <option key={p.contactId} value={p.contactId}>
                  {p.name}
                </option>
              ))}
              {people !== null ? <option value="">אדם חדש בתיק</option> : null}
            </select>
            {/* A disabled select sends nothing: until the list is in, it is a new person. */}
          </div>
        ) : null}
        {clientId && isNew && people !== null ? (
          <>
            <div>
              <label htmlFor="assign-name" className={label}>
                שם
              </label>
              <input id="assign-name" name="name" defaultValue={props.defaultName} maxLength={120} className={input} />
            </div>
            <div>
              <label htmlFor="assign-role" className={label}>
                תפקיד (אם אין שם)
              </label>
              <input id="assign-role" name="role" maxLength={120} className={input} />
            </div>
          </>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending || !clientId || loading || people === null}
            className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "שומר..." : isNew ? "שמירה בתיק הלקוח" : "הוספת המספר לאיש הקשר"}
          </button>
          <CancelButton target={ref} />
        </div>
        {state?.error ? (
          <p role="alert" className="text-sm text-app-error">
            {state.error}
          </p>
        ) : null}
      </form>
    </details>
  );
}

/// "שיוך מספר נוסף": another number for someone already in a client's file.
export function AddNumberForm(props: { contactId: string }) {
  const [state, action, pending] = useActionState<ContactState | undefined, FormData>(addNumberToContactAction, undefined);
  const ref = useRef<HTMLDetailsElement>(null);
  if (state?.ok) return <p className="text-sm text-app-success">המספר נוסף.</p>;
  return (
    <details ref={ref} className="rounded-lg border border-dashed border-app-border-strong">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-app-text-primary">שיוך מספר נוסף</summary>
      <form action={action} className="space-y-3 px-3 pb-3">
        <input type="hidden" name="contactId" value={props.contactId} />
        <div>
          <label htmlFor="add-phone" className={label}>
            מספר
          </label>
          <input id="add-phone" name="phone" type="tel" dir="ltr" required placeholder="050-0000000" className={input} />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-60">
            {pending ? "שומר..." : "הוספה"}
          </button>
          <CancelButton target={ref} />
        </div>
        {state?.error ? (
          <p role="alert" className="text-sm text-app-error">
            {state.error}
          </p>
        ) : null}
      </form>
    </details>
  );
}

/// A group's client: chosen once by the number's owner or a manager.
export function GroupClientForm(props: { channelId: string; chatId: string; current: string; clients: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState<ContactState | undefined, FormData>(assignGroupToClientAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="channelId" value={props.channelId} />
      <input type="hidden" name="chatId" value={props.chatId} />
      <label htmlFor="group-client" className={label}>
        לקוח
      </label>
      <select id="group-client" name="clientId" defaultValue={props.current} className={input}>
        <option value="">לא משויכת ללקוח</option>
        {props.clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "שומר..." : "שמירה"}
      </button>
      {state?.error ? (
        <p role="alert" className="text-sm text-app-error">
          {state.error}
        </p>
      ) : state?.ok ? (
        <p role="status" className="text-sm text-app-success">
          נשמר.
        </p>
      ) : null}
    </form>
  );
}

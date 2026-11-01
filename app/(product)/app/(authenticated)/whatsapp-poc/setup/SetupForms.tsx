"use client";
import { useActionState } from "react";
import {
  blockAction,
  blockManyAction,
  connectChannelAction,
  decideBlockAction,
  revokeBlockAction,
  startStoringAction,
  type SetupState,
} from "./actions";

function Result({ state }: { state: SetupState | undefined }) {
  if (state?.error)
    return (
      <p role="alert" className="text-sm text-app-error">
        {state.error}
      </p>
    );
  if (state?.ok)
    return (
      <p role="status" className="text-sm text-app-success">
        {state.ok}
      </p>
    );
  return null;
}

const primary = "min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-60";
const secondary = "min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm text-app-text-primary disabled:opacity-60";

export function ConnectForm({ people }: { people: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(connectChannelAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-app-text-primary">מי לא יראה אף שיחה מהמספר הזה, גם לא עם לקוחות שלו</legend>
        {people.map((p) => (
          <label key={p.id} className="flex min-h-11 items-center gap-2 text-sm text-app-text-primary">
            <input type="checkbox" name="excluded" value={p.id} className="size-5" />
            {p.name}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={pending} className={primary}>
        {pending ? "מחבר..." : "חיבור המספר"}
      </button>
      <Result state={state} />
    </form>
  );
}

export type SetupRow = { key: string; value: string; name: string; detail: string; blocked: boolean };

export function BlockManyForm({ channelId, rows }: { channelId: string; rows: SetupRow[] }) {
  const [state, action, pending] = useActionState(blockManyAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="channelId" value={channelId} />
      <ul className="divide-y divide-app-border rounded-xl border border-app-border bg-white">
        {rows.map((r) => (
          <li key={r.key}>
            <label className="flex min-h-12 items-center gap-3 px-3 py-2">
              <input type="checkbox" name="block" value={r.value} defaultChecked={r.blocked} disabled={r.blocked} className="size-5 flex-none" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-app-text-primary">{r.name}</span>
                <span dir="ltr" className="block text-end text-xs text-app-text-secondary">
                  {r.detail}
                </span>
              </span>
              <span className="flex-none text-xs text-app-text-secondary">{r.blocked ? "חסום" : "לא לשמור"}</span>
            </label>
          </li>
        ))}
      </ul>
      <button type="submit" disabled={pending} className={secondary}>
        {pending ? "שומר..." : "שמירת הסימונים"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function StartForm({ channelId }: { channelId: string }) {
  const [state, action, pending] = useActionState(startStoringAction, undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("מעכשיו נשמרות כל השיחות של המספר, חוץ ממה שסימנת. להתחיל?")) e.preventDefault();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="channelId" value={channelId} />
      <button type="submit" disabled={pending} className={primary}>
        {pending ? "מתחיל..." : "התחל לשמור"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function DecideForm({ blockId }: { blockId: string }) {
  const [state, action, pending] = useActionState(decideBlockAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="blockId" value={blockId} />
      <button type="submit" name="decision" value="approve" disabled={pending} className={primary}>
        אישור ומחיקה
      </button>
      <button type="submit" name="decision" value="reject" disabled={pending} className={secondary}>
        דחייה
      </button>
      <Result state={state} />
    </form>
  );
}

export function RevokeForm({ blockId }: { blockId: string }) {
  const [state, action, pending] = useActionState(revokeBlockAction, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="blockId" value={blockId} />
      <button type="submit" disabled={pending} className={secondary}>
        ביטול החסימה
      </button>
      <Result state={state} />
    </form>
  );
}

/// The button on a conversation: "לא לשמור שיחות עם המספר הזה".
export function BlockButton(props: { channelId: string; kind: "PHONE" | "CHAT"; value: string; label: string; manager: boolean }) {
  const [state, action, pending] = useActionState(blockAction, undefined);
  if (state?.ok) return <Result state={state} />;
  const question = props.manager
    ? "לא לשמור שיחות עם המספר הזה? כל מה שנשמר ממנו יימחק, ולא יישמר ממנו כלום מעכשיו."
    : "לבקש לא לשמור שיחות עם המספר הזה? ההודעות יוסתרו מיד, ומנהל יחליט אם למחוק.";
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(question)) e.preventDefault();
      }}
      className="inline-flex flex-col gap-1"
    >
      <input type="hidden" name="channelId" value={props.channelId} />
      <input type="hidden" name="kind" value={props.kind} />
      <input type="hidden" name="value" value={props.value} />
      <input type="hidden" name="label" value={props.label} />
      <button type="submit" disabled={pending} className="min-h-11 rounded-lg border border-app-border-strong bg-white px-3 text-sm text-app-text-primary">
        {props.kind === "CHAT" ? "לא לשמור את הקבוצה הזו" : "לא לשמור שיחות עם המספר הזה"}
      </button>
      <Result state={state} />
    </form>
  );
}

"use client";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  blockAction,
  blockManyAction,
  changeChannelOwnerAction,
  connectChannelAction,
  decideBlockAction,
  loadHistoryAction,
  importManualRecordingsAction,
  keepAllNewChatsAction,
  reviewNewChatAction,
  revokeBlockAction,
  startStoringAction,
  updateExcludedViewersAction,
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

/// The app's own confirmation, in place of the browser's confirm() (Cowork's
/// check, 1.11.2026: a browser that blocks confirm() answers "no" in
/// silence, so the button did nothing and said nothing). The first press
/// shows the question and two buttons; only the second submits.
function ConfirmSubmit(props: { label: string; question: string; yes: string; pending: boolean; pendingLabel: string; className: string }) {
  const t = useTranslations("comms.setup.forms");
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} disabled={props.pending} className={props.className}>
        {props.pending ? props.pendingLabel : props.label}
      </button>
    );
  }
  return (
    <div role="alertdialog" aria-label={props.label} className="space-y-2 rounded-lg border border-app-border-strong bg-app-surface-sunken p-3">
      <p className="text-sm text-app-text-primary">{props.question}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={props.pending} className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-60">
          {props.pending ? props.pendingLabel : props.yes}
        </button>
        <button type="button" onClick={() => setAsking(false)} className="min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm text-app-text-primary">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

const primary = "min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-60";
const secondary = "min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm text-app-text-primary disabled:opacity-60";

export function ConnectForm(props: {
  accounts: Array<{ id: string; name: string }>;
  manualAccount: boolean;
  people: Array<{ id: string; name: string }>;
  /// Managers choose whose number it is; anyone else connects their own.
  owners: Array<{ id: string; name: string }> | null;
  selfId: string;
}) {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(connectChannelAction, undefined);
  const field = "mt-1 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary";
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="connect-account" className="block text-xs font-medium text-app-text-secondary">
          {t("account")}
        </label>
        {props.manualAccount ? (
          <input id="connect-account" name="accountId" dir="ltr" required placeholder="acc_..." className={field} />
        ) : (
          <select id="connect-account" name="accountId" required defaultValue="" className={field}>
            <option value="" disabled>
              {t("pickNumber")}
            </option>
            {props.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {props.owners ? (
        <div>
          <label htmlFor="connect-owner" className="block text-xs font-medium text-app-text-secondary">
            {t("whose")}
          </label>
          <select id="connect-owner" name="ownerUserId" defaultValue={props.selfId} className={field}>
            {props.owners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-app-text-primary">{t("excludedLegend")}</legend>
        {props.people.map((p) => (
          <label key={p.id} className="flex min-h-11 items-center gap-2 text-sm text-app-text-primary">
            <input type="checkbox" name="excluded" value={p.id} className="size-5" />
            {p.name}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={pending} className={primary}>
        {pending ? t("connecting") : t("connect")}
      </button>
      <Result state={state} />
    </form>
  );
}

/// "לא רואים שיחות מהמספר" of a connected number: the names, and for the
/// owner or a manager a "עריכה" that opens the same checkboxes as on connect.
/// `locked`: people the editor cannot take off (themselves, when on it).
export function ExcludedViewersForm(props: {
  channelId: string;
  people: Array<{ id: string; name: string }>;
  excluded: string[];
  locked: string[];
  /// Name and email of everyone already on the list, active or not.
  labels?: Record<string, string>;
  /// "כולם" (5.11.2026): nobody but the owner, people added later too.
  excludeAll?: boolean;
  /// Only the owner may turn "כולם" off.
  allLocked?: boolean;
}) {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(updateExcludedViewersAction, undefined);
  const [editing, setEditing] = useState(false);
  const [all, setAll] = useState(Boolean(props.excludeAll));
  const nameOf = new Map([...Object.entries(props.labels ?? {}), ...props.people.map((p) => [p.id, p.name] as [string, string])]);
  const names = props.excluded.map((id) => nameOf.get(id) ?? id);
  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-app-text-secondary">
          {t("excludedNow")}{" "}
          {props.excludeAll ? t("excludedAll") : names.length ? `${names.join(", ")}.` : t("excludedNone")}
        </p>
        <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-11 items-center text-sm text-app-text-primary underline">
          {t("edit")}
        </button>
        <Result state={state} />
      </div>
    );
  }
  return (
    <form
      action={async (fd) => {
        await action(fd);
        setEditing(false);
      }}
      className="space-y-2 rounded-lg bg-app-surface-sunken p-3"
    >
      <input type="hidden" name="channelId" value={props.channelId} />
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-app-text-primary">{t("excludedLegend")}</legend>
        <label className="flex min-h-11 items-center gap-2 border-b border-app-border pb-1 text-sm font-medium text-app-text-primary">
          <input
            type="checkbox"
            name="excludeAll"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
            disabled={props.allLocked && all}
            className="size-5"
          />
          {props.allLocked && all ? <input type="hidden" name="excludeAll" value="on" /> : null}
          {t("excludeAll")}
          {props.allLocked && all ? <span className="text-xs font-normal text-app-text-secondary">{t("ownerOnlyCancels")}</span> : null}
        </label>
        {all ? <p className="text-xs text-app-text-secondary">{t("excludeAllHint")}</p> : null}
        {props.people.map((p) => {
          const locked = props.locked.includes(p.id);
          return (
            <label key={p.id} className={`flex min-h-11 items-center gap-2 text-sm text-app-text-primary ${all ? "opacity-60" : ""}`}>
              <input type="checkbox" name="excluded" value={p.id} defaultChecked={props.excluded.includes(p.id)} disabled={locked} className="size-5" />
              {locked ? <input type="hidden" name="excluded" value={p.id} /> : null}
              {p.name}
              {locked ? <span className="text-xs text-app-text-secondary">{t("ownerOnlyRemoves")}</span> : null}
            </label>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? t("saving") : t("saveList")}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={pending} className={secondary}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

export type SetupRow ={ key: string; value: string; name: string; detail: string; blocked: boolean };

export function BlockManyForm({ channelId, rows }: { channelId: string; rows: SetupRow[] }) {
  const t = useTranslations("comms.setup.forms");
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
                <span dir="auto" className="block truncate text-sm font-medium text-app-text-primary">{r.name}</span>
                <span dir="ltr" className="block text-end text-xs text-app-text-secondary">
                  {r.detail}
                </span>
              </span>
              <span className="flex-none text-xs text-app-text-secondary">{r.blocked ? t("blocked") : t("dontStore")}</span>
            </label>
          </li>
        ))}
      </ul>
      <button type="submit" disabled={pending} className={secondary}>
        {pending ? t("saving") : t("saveMarks")}
      </button>
      <Result state={state} />
    </form>
  );
}

export function StartForm({ channelId }: { channelId: string }) {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(startStoringAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="channelId" value={channelId} />
      <ConfirmSubmit
        label={t("start")}
        question={t("startQuestion")}
        yes={t("startYes")}
        pending={pending}
        pendingLabel={t("starting")}
        className={primary}
      />
      <Result state={state} />
    </form>
  );
}

export function DecideForm({ blockId }: { blockId: string }) {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(decideBlockAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="blockId" value={blockId} />
      <button type="submit" name="decision" value="approve" disabled={pending} className={primary}>
        {t("approve")}
      </button>
      <button type="submit" name="decision" value="reject" disabled={pending} className={secondary}>
        {t("reject")}
      </button>
      <Result state={state} />
    </form>
  );
}

export function RevokeForm({ blockId }: { blockId: string }) {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(revokeBlockAction, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="blockId" value={blockId} />
      <button type="submit" disabled={pending} className={secondary}>
        {t("revoke")}
      </button>
      <Result state={state} />
    </form>
  );
}

/// The button on a conversation: "לא לשמור שיחות עם המספר הזה".
export function BlockButton(props: {
  channelId: string;
  kind: "PHONE" | "CHAT";
  value: string;
  label: string;
  manager: boolean;
  /// 5.11.2026 (Ariel): in the conversation's "עוד" menu, not a button of
  /// its own in the header: red, with a line on what it does.
  asMenuItem?: boolean;
}) {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(blockAction, undefined);
  if (state?.ok) return <Result state={state} />;
  const question = props.manager ? t("blockQuestionManager") : t("blockQuestion");
  const label = props.kind === "CHAT" ? t("blockGroup") : t("blockNumber");
  return (
    <form action={action} className={props.asMenuItem ? "flex w-full flex-col gap-0.5" : "inline-flex max-w-sm flex-col gap-1"}>
      <input type="hidden" name="channelId" value={props.channelId} />
      <input type="hidden" name="kind" value={props.kind} />
      <input type="hidden" name="value" value={props.value} />
      <input type="hidden" name="label" value={props.label} />
      <ConfirmSubmit
        label={label}
        question={question}
        yes={props.manager ? t("blockYesManager") : t("blockYes")}
        pending={pending}
        pendingLabel={t("saving")}
        className={
          props.asMenuItem
            ? "flex min-h-11 w-full items-center px-3 text-start text-sm text-app-error hover:bg-app-error-soft"
            : "min-h-11 rounded-lg border border-app-border-strong bg-white px-3 text-sm text-app-text-primary"
        }
      />
      {props.asMenuItem ? (
        <p className="px-3 pb-1 text-xs text-app-text-secondary">
          {props.manager ? t("blockHintManager") : t("blockHint")}
        </p>
      ) : null}
      <Result state={state} />
    </form>
  );
}

export function ManualRecordingsForm() {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(importManualRecordingsAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <button type="submit" disabled={pending} className={secondary}>
        {pending ? t("starting") : t("importManual")}
      </button>
      <Result state={state} />
    </form>
  );
}

export function LoadHistoryForm({ channelId }: { channelId: string }) {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(loadHistoryAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="channelId" value={channelId} />
      <button type="submit" disabled={pending} className={secondary}>
        {pending ? t("starting") : t("loadHistory")}
      </button>
      <Result state={state} />
    </form>
  );
}

/// "שינוי בעלים" on a number's card, for a manager (5.11.2026). Three steps:
/// the button, then the list of active people, then a confirmation that
/// names the current owner and the new one, each with their email.
export function ChangeOwnerForm(props: { channelId: string; current: string; candidates: Array<{ id: string; name: string }> }) {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(changeChannelOwnerAction, undefined);
  const [step, setStep] = useState<"closed" | "pick" | "confirm">("closed");
  const [picked, setPicked] = useState("");
  const chosen = props.candidates.find((p) => p.id === picked) ?? null;
  const field = "mt-1 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary";
  const selectId = `owner-${props.channelId}`;
  if (state?.ok) return <Result state={state} />;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="channelId" value={props.channelId} />
      <input type="hidden" name="ownerUserId" value={picked} />
      {step === "closed" ? (
        <button type="button" onClick={() => setStep("pick")} className={secondary}>
          {t("changeOwner")}
        </button>
      ) : null}
      {step === "pick" ? (
        <div className="space-y-2 rounded-lg border border-app-border-strong bg-app-surface-sunken p-3">
          <label htmlFor={selectId} className="block text-xs font-medium text-app-text-secondary">
            {t("newOwnerLabel")}
          </label>
          <select id={selectId} value={picked} onChange={(e) => setPicked(e.target.value)} className={field}>
            <option value="" disabled>
              {t("pickUser")}
            </option>
            {props.candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!chosen} onClick={() => setStep("confirm")} className={primary}>
              {t("continue")}
            </button>
            <button type="button" onClick={() => setStep("closed")} className={secondary}>
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {step === "confirm" && chosen ? (
        <div role="alertdialog" aria-label={t("changeOwner")} className="space-y-2 rounded-lg border border-app-border-strong bg-app-surface-sunken p-3">
          <p className="text-sm text-app-text-primary">{t("currentOwner", { name: props.current })}</p>
          <p className="text-sm text-app-text-primary">{t("newOwner", { name: chosen.name })}</p>
          <p className="text-sm text-app-text-secondary">{t("ownerNote")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={primary}>
              {pending ? t("saving") : t("changeOwnerYes")}
            </button>
            <button type="button" onClick={() => setStep("pick")} disabled={pending} className={secondary}>
              {t("back")}
            </button>
          </div>
        </div>
      ) : null}
      <Result state={state} />
    </form>
  );
}

export type NewChatRow = {
  conversationId: string;
  name: string;
  detail: string;
  clients: string[];
};

/// One row of "שיחות חדשות לבדיקה" (design 9, 5.11.2026): "לשמור" or "לא
/// לשמור", one click each. A kept chat can be put back on the list; "לא
/// לשמור" asks first, since a manager's deletes what was kept.
function NewChatDecision({ row, manager }: { row: NewChatRow; manager: boolean }) {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(reviewNewChatAction, undefined);
  const [asking, setAsking] = useState(false);
  const decided = state?.ok ? state.ok : null;
  const btn = "min-h-10 whitespace-nowrap rounded-lg border px-3 text-sm disabled:opacity-60";
  return (
    <li className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${decided ? "opacity-70" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-app-text-primary">
          <bdi>{row.name}</bdi>
        </p>
        <p className="text-xs text-app-text-secondary">{row.detail}</p>
      </div>
      {row.clients.length > 0 ? (
        <span className="rounded-full bg-app-success-soft px-2 py-0.5 text-xs text-app-success">{t("inFileOf", { clients: row.clients.join(", ") })}</span>
      ) : null}
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="conversationId" value={row.conversationId} />
        {decided ? (
          <>
            <span role="status" className="text-xs text-app-text-secondary">
              {decided}
            </span>
            {state?.kept ? (
              <button type="submit" name="decision" value="undo" disabled={pending} className="min-h-10 text-sm text-app-text-primary underline">
                {t("cancel")}
              </button>
            ) : null}
          </>
        ) : asking ? (
          <span role="alertdialog" aria-label={t("dontStore")} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-app-text-primary">{manager ? t("chatBlockQuestionManager") : t("chatBlockQuestion")}</span>
            <button type="submit" name="decision" value="block" disabled={pending} className={`${btn} border-navy bg-navy text-white`}>
              {pending ? t("saving") : t("dontStoreYes")}
            </button>
            <button type="button" onClick={() => setAsking(false)} className={`${btn} border-app-border-strong bg-white text-app-text-primary`}>
              {t("cancel")}
            </button>
          </span>
        ) : (
          <>
            <button type="submit" name="decision" value="keep" disabled={pending} className={`${btn} border-navy bg-navy text-white`}>
              {t("keep")}
            </button>
            <button type="button" onClick={() => setAsking(true)} disabled={pending} className={`${btn} border-app-border-strong bg-white text-app-text-primary`}>
              {t("dontStore")}
            </button>
          </>
        )}
      </form>
      {state?.error ? (
        <p role="alert" className="w-full text-sm text-app-error">
          {state.error}
        </p>
      ) : null}
    </li>
  );
}

/// "שיחות חדשות לבדיקה": the chats that began after storing started, with a
/// decision on each, and "לשמור את כל השאר" for the rest.
export function NewChatsReview(props: { channelId: string; rows: NewChatRow[]; total: number; manager: boolean }) {
  const t = useTranslations("comms.setup.forms");
  const [state, action, pending] = useActionState(keepAllNewChatsAction, undefined);
  return (
    <div className="overflow-hidden rounded-xl border border-app-border bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-app-border bg-app-surface-sunken px-3 py-2.5">
        <h3 className="text-sm font-medium text-app-text-primary">{t("newChats")}</h3>
        <span className="rounded-full bg-gold px-2 text-xs text-white">{props.total}</span>
        <p className="w-full text-xs text-app-text-secondary sm:ms-auto sm:w-auto">
          {t("newChatsHint")}
        </p>
      </div>
      <ul className="divide-y divide-app-border">
        {props.rows.map((r) => (
          <NewChatDecision key={r.conversationId} row={r} manager={props.manager} />
        ))}
      </ul>
      <form action={action} className="flex flex-wrap items-center gap-3 border-t border-app-border px-3 py-2.5">
        <input type="hidden" name="channelId" value={props.channelId} />
        {props.rows.map((r) => (
          <input key={r.conversationId} type="hidden" name="conversationId" value={r.conversationId} />
        ))}
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? t("saving") : t("keepRest")}
        </button>
        {props.total > props.rows.length ? <span className="text-xs text-app-text-secondary">{t("shownOf", { shown: props.rows.length, total: props.total })}</span> : null}
        <Result state={state} />
      </form>
    </div>
  );
}

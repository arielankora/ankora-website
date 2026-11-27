"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { changeMailboxAccessAction, grantMailboxAccessAction } from "./actions";

// Who reaches a client mailbox through the connector (27.11.2026, Ariel,
// https://claude.ai/artifact/5GT2bZeiXvbMCfCYBoe4Pg): the system admins, the
// account manager and the backup manager by role, and the people on the
// list. Folded under the mailbox's card; edited by those same three roles.

export type AccessView = {
  byRole: { name: string; reason: "accountManager" | "backupManager" }[];
  list: { id: string; userId: string; name: string; canSend: boolean }[];
  candidates: { userId: string; name: string }[];
};

const SELECT = "h-11 rounded-[10px] border border-app-border-strong bg-white px-2 text-sm text-app-text-primary";

export function MailboxAccessPanel(props: { clientId: string; connectionId: string; view: AccessView; mayEdit: boolean }) {
  const t = useTranslations("clients.connections.access");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [userId, setUserId] = useState("");
  const [level, setLevel] = useState<"send" | "read">("send");
  const run = (fn: () => Promise<{ error?: string; ok?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg({ text: r.error ?? r.ok ?? "", error: !!r.error });
    });
  const roles = [t("admins"), ...props.view.byRole.map((r) => t(r.reason, { name: r.name }))].join(", ");

  return (
    <details className="rounded-[10px] border border-app-border px-3 py-2" data-testid="mailbox-access">
      <summary className="tap-area cursor-pointer text-sm font-medium text-app-text-primary">{t("title", { count: props.view.list.length })}</summary>
      <div className="mt-2 flex flex-col gap-2 text-xs text-app-text-secondary">
        <p>{t("always", { names: roles })}</p>
        {props.view.list.length === 0 ? (
          <p>{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {props.view.list.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2" data-testid="mailbox-access-row">
                <span className="min-w-0 flex-1 text-sm text-app-text-primary">{a.name}</span>
                {props.mayEdit ? (
                  <>
                    <label className="sr-only" htmlFor={`level-${a.id}`}>
                      {t("levelLabel", { name: a.name })}
                    </label>
                    <select
                      id={`level-${a.id}`}
                      className={SELECT}
                      disabled={pending}
                      value={a.canSend ? "send" : "read"}
                      onChange={(e) => run(() => changeMailboxAccessAction(props.clientId, a.id, { canSend: e.target.value === "send" }))}
                    >
                      <option value="send">{t("send")}</option>
                      <option value="read">{t("read")}</option>
                    </select>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => changeMailboxAccessAction(props.clientId, a.id, { remove: true }))}
                      className="h-11 rounded-[10px] border border-app-border bg-white px-3 text-sm text-app-error"
                    >
                      {t("remove")}
                    </button>
                  </>
                ) : (
                  <span>{a.canSend ? t("send") : t("read")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {props.mayEdit &&
          (props.view.candidates.length === 0 ? (
            <p>{t("noCandidates")}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`add-${props.connectionId}`}>
                {t("whoLabel")}
              </label>
              <select id={`add-${props.connectionId}`} className={`${SELECT} min-w-0 flex-1`} value={userId} disabled={pending} onChange={(e) => setUserId(e.target.value)}>
                <option value="">{t("pick")}</option>
                {props.view.candidates.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`add-level-${props.connectionId}`}>
                {t("newLevelLabel")}
              </label>
              <select id={`add-level-${props.connectionId}`} className={SELECT} value={level} disabled={pending} onChange={(e) => setLevel(e.target.value as "send" | "read")}>
                <option value="send">{t("send")}</option>
                <option value="read">{t("read")}</option>
              </select>
              <button
                type="button"
                disabled={pending || !userId}
                onClick={() =>
                  run(async () => {
                    const r = await grantMailboxAccessAction(props.clientId, props.connectionId, userId, level === "send");
                    if (!r.error) setUserId("");
                    return r;
                  })
                }
                className="h-11 rounded-[10px] bg-app-surface-nav px-3 text-sm font-medium text-app-surface-page disabled:opacity-60"
              >
                {t("add")}
              </button>
            </div>
          ))}
        {msg && (
          <p role="status" className={msg.error ? "text-app-error" : "text-app-success"}>
            {msg.text}
          </p>
        )}
      </div>
    </details>
  );
}

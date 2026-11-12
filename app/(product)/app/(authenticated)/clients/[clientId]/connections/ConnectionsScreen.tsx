"use client";

import { useActionState, useState, useTransition } from "react";
import type { ConnectionKind } from "@prisma/client";
import { useFormatter, useTranslations } from "next-intl";
import { addAppPasswordAction, disconnectAction, testConnectionAction } from "./actions";

// The connections screen as designed (artboard "חיבורים של הלקוח",
// https://claude.ai/artifact/CjzpzkxiB8xRvpaZNBWkAr).

type Row = {
  id: string;
  kind: ConnectionKind;
  account: string;
  scopes: string[];
  ownerUserId: string | null;
  consentText: string | null;
  connectedAt: string;
  connectedByName: string | null;
  lastUsedAt: string | null;
  usedBy: number;
};

const INPUT = "w-full rounded-[10px] border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary";
type ScopeTag = "appPassword" | "mailOnly" | "viaGoogle" | "sendOnly" | "mailReplies" | "driveRead" | "driveWrite";

function scopeTags(r: Row): ScopeTag[] {
  if (r.kind === "MAIL_APP_PASSWORD") return ["appPassword", "mailOnly"];
  if (r.kind === "MANAGER_SEND") return ["viaGoogle", "sendOnly"];
  const t: ScopeTag[] = ["viaGoogle"];
  if (r.scopes.some((s) => s.endsWith("gmail.metadata"))) t.push("mailReplies");
  if (r.scopes.some((s) => s.endsWith("drive.metadata.readonly"))) t.push("driveRead");
  if (r.scopes.some((s) => s.endsWith("drive.file"))) t.push("driveWrite");
  return t;
}

export function ConnectionsScreen(props: {
  clientId: string;
  clientName: string;
  aiExcluded: boolean;
  connections: Row[];
  mayManage: boolean;
  googleReady: boolean;
  userId: string;
  notice: { text: string; error: boolean } | null;
}) {
  const t = useTranslations("clients.connections");
  const format = useFormatter();
  const day = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "numeric", year: "numeric" });
  const [msg, setMsg] = useState<{ id: string | null; text: string; error: boolean } | null>(props.notice ? { id: null, text: props.notice.text, error: props.notice.error } : null);
  const [folder, setFolder] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  // 5.11.2026: a browser confirm() never showed in an embedded browser, and
  // the disconnect silently did nothing. The question is asked in the page.
  const [confirming, setConfirming] = useState<string | null>(null);
  const runDisconnect = (id: string) => {
    setConfirming(null);
    start(async () => {
      const r = await disconnectAction(props.clientId, id);
      setMsg({ id: null, text: r.error ?? r.ok ?? "", error: !!r.error });
    });
  };
  const confirmBox = (id: string, question: string) =>
    confirming === id && (
      <div className="flex basis-full flex-wrap items-center gap-2 rounded-[10px] bg-app-error-soft px-3 py-2" role="alertdialog" aria-label={t("confirmLabel")} data-testid="disconnect-confirm">
        <span className="text-xs text-app-error">{question}</span>
        <button type="button" onClick={() => runDisconnect(id)} className="h-11 rounded-[10px] bg-app-error px-3 text-sm font-medium text-white">
          {t("confirmYes")}
        </button>
        <button type="button" onClick={() => setConfirming(null)} className="h-11 rounded-[10px] border border-app-border bg-white px-3 text-sm text-app-text-primary">
          {t("cancel")}
        </button>
      </div>
    );
  const [formState, formAction, formPending] = useActionState(addAppPasswordAction, undefined);
  const mine = props.connections.find((c) => c.kind === "MANAGER_SEND" && c.ownerUserId === props.userId);
  const google = (purpose: "CLIENT" | "SEND") => `/api/connections/google/start?clientId=${encodeURIComponent(props.clientId)}&purpose=${purpose}`;

  return (
    <div className="flex flex-col gap-5" data-testid="connections-screen">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-app-text-secondary">{t("eyebrow", { name: props.clientName })}</span>
          <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
          <p className="text-sm text-app-text-secondary">{t("intro")}</p>
        </div>
      </header>

      {msg && !msg.id && (
        <p role="status" className={`rounded-[10px] px-3 py-2 text-sm ${msg.error ? "bg-app-error-soft text-app-error" : "bg-app-success-soft text-app-success"}`}>
          {msg.text}
        </p>
      )}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {props.connections
          .filter((c) => c.kind !== "MANAGER_SEND")
          .map((c) => (
            <li key={c.id} className="flex flex-col gap-3 rounded-[14px] border border-app-border bg-white p-5" data-testid="connection-card">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-base font-medium text-app-text-primary">{t(`kinds.${c.kind}`)}</strong>
                <span className="rounded-full bg-app-success-soft px-2.5 py-0.5 text-xs font-medium text-app-success">{t("connected")}</span>
              </div>
              <span className="text-sm text-app-text-secondary" dir="ltr">
                {c.account}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {scopeTags(c).map((tag) => (
                  <span key={tag} className="rounded-md bg-app-neutral-soft px-2 py-0.5 text-xs text-app-text-secondary">
                    {t(`scopes.${tag}`)}
                  </span>
                ))}
              </div>
              <span className="text-xs text-app-text-secondary">
                {c.consentText ?? t("noConsent")} · {day(c.connectedAt)}
                {c.connectedByName ? ` · ${t("connectedBy", { name: c.connectedByName })}` : ""}
              </span>
              <span className="text-xs text-app-text-secondary">{c.usedBy ? t("usedBy", { count: c.usedBy }) : t("notUsed")}</span>
              {c.kind === "GOOGLE_OAUTH" && (
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  {t("folderId")}
                  <input dir="ltr" value={folder[c.id] ?? ""} onChange={(e) => setFolder({ ...folder, [c.id]: e.target.value })} className={INPUT} />
                </label>
              )}
              {msg?.id === c.id && <p className={`text-xs ${msg.error ? "text-app-error" : "text-app-success"}`}>{msg.text}</p>}
              {props.mayManage && (
                <div className="mt-auto flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => start(async () => {
                      const r = await testConnectionAction(c.id, folder[c.id] || null);
                      setMsg({ id: c.id, text: r.error ?? r.ok ?? "", error: !!r.error });
                    })}
                    className="h-11 flex-1 rounded-[10px] border border-app-border bg-white text-sm text-app-text-primary"
                  >
                    {t("test")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirming(c.id)}
                    className="h-11 flex-1 rounded-[10px] border border-app-border bg-white text-sm text-app-error"
                  >
                    {t("disconnect")}
                  </button>
                </div>
              )}
              {confirmBox(c.id, c.usedBy ? t("confirmInUse", { count: c.usedBy }) : t("confirmGoogle"))}
            </li>
          ))}

        {props.mayManage && (
          <li className="flex flex-col gap-3 rounded-[14px] border border-dashed border-app-border-strong bg-white p-5">
            <strong className="text-base font-medium text-app-text-primary">{t("new.title")}</strong>
            <span className="text-sm text-app-text-secondary">{t("new.how")}</span>
            {props.googleReady ? (
              <a href={google("CLIENT")} className="flex min-h-16 flex-col gap-0.5 rounded-[10px] border-2 border-app-accent px-3.5 py-2.5 text-start text-app-text-primary">
                <span className="text-sm font-medium">{t("new.google")}</span>
                <span className="text-xs text-app-text-secondary">{t("new.googleHint")}</span>
              </a>
            ) : (
              <p className="rounded-[10px] bg-app-neutral-soft px-3 py-2 text-xs text-app-text-secondary">{t("new.googleNotReady")}</p>
            )}
            <details className="rounded-[10px] border border-app-border px-3.5 py-2.5">
              <summary className="cursor-pointer text-sm font-medium text-app-text-primary">{t("new.appPassword")}</summary>
              <form action={formAction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="clientId" value={props.clientId} />
                <p className="text-xs text-app-text-secondary">{t("new.appPasswordHint")}</p>
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  {t("new.email")}
                  <input name="account" dir="ltr" autoComplete="off" className={INPUT} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  {t("new.password")}
                  <input name="appPassword" type="password" dir="ltr" autoComplete="new-password" className={INPUT} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  {t("new.consent")}
                  <input name="consentText" className={INPUT} />
                </label>
                {formState?.error && <p className="text-xs text-app-error">{formState.error}</p>}
                {formState?.ok && <p className="text-xs text-app-success">{formState.ok}</p>}
                <button type="submit" disabled={formPending} className="h-11 rounded-[10px] bg-app-surface-nav text-sm font-medium text-app-surface-page">
                  {t("new.save")}
                </button>
              </form>
            </details>
          </li>
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-app-border bg-white px-4 py-3.5">
        <strong className="text-sm font-medium text-app-text-primary">{t("send.title")}</strong>
        <span className="text-sm text-app-text-secondary">{t("send.intro")}</span>
        {mine ? (
          <span className="ms-auto flex flex-wrap items-center gap-2" data-testid="send-connection">
            <span className="rounded-full bg-app-success-soft px-2.5 py-0.5 text-xs font-medium text-app-success" dir="auto">
              {t("send.mine", { account: mine.account })}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => start(async () => {
                const r = await testConnectionAction(mine.id, null);
                setMsg({ id: mine.id, text: r.error ?? r.ok ?? "", error: !!r.error });
              })}
              className="h-11 rounded-[10px] border border-app-border bg-white px-3 text-sm text-app-text-primary"
            >
              {t("test")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(mine.id)}
              className="h-11 rounded-[10px] border border-app-border bg-white px-3 text-sm text-app-error"
            >
              {t("disconnect")}
            </button>
            {confirmBox(mine.id, t("send.confirm"))}
            {msg?.id === mine.id && <span className={`basis-full text-xs ${msg.error ? "text-app-error" : "text-app-success"}`}>{msg.text}</span>}
          </span>
        ) : props.mayManage && props.googleReady ? (
          <a href={google("SEND")} className="ms-auto rounded-[10px] border border-app-border px-3 py-2 text-sm text-app-text-primary">
            {t("send.connect")}
          </a>
        ) : (
          <span className="ms-auto text-xs text-app-text-tertiary">{t("send.notConnected")}</span>
        )}
      </div>

      {props.aiExcluded && (
        <p className="rounded-[10px] bg-app-info-soft px-4 py-3 text-sm text-app-info">
          {t("aiExcluded")}
        </p>
      )}
    </div>
  );
}

"use client";

import { useActionState, useState, useTransition } from "react";
import type { ConnectionKind } from "@prisma/client";
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
const KIND: Record<ConnectionKind, string> = { GOOGLE_OAUTH: "Google של הלקוח", MAIL_APP_PASSWORD: "מייל של הלקוח", MANAGER_SEND: "שליחה מהתיבה של מנהל התיק" };

function scopeTags(r: Row): string[] {
  if (r.kind === "MAIL_APP_PASSWORD") return ["סיסמת אפליקציה", "מייל בלבד"];
  if (r.kind === "MANAGER_SEND") return ["דרך Google", "שליחה בלבד"];
  const t = ["דרך Google"];
  if (r.scopes.some((s) => s.endsWith("gmail.metadata"))) t.push("מייל: רק אם הגיעה תשובה");
  if (r.scopes.some((s) => s.endsWith("drive.metadata.readonly"))) t.push("דרייב: רואה קבצים בתיקייה");
  if (r.scopes.some((s) => s.endsWith("drive.file"))) t.push("דרייב: כותב קבצים שהנוהל יוצר");
  return t;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric" });

export function ConnectionsScreen(props: {
  clientId: string;
  clientName: string;
  aiExcluded: boolean;
  connections: Row[];
  mayManage: boolean;
  googleReady: boolean;
  userId: string;
  notice: string | null;
}) {
  const [msg, setMsg] = useState<{ id: string | null; text: string; error: boolean } | null>(props.notice ? { id: null, text: props.notice, error: props.notice.includes("נכשל") || props.notice.includes("לא") } : null);
  const [folder, setFolder] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [formState, formAction, formPending] = useActionState(addAppPasswordAction, undefined);
  const mine = props.connections.find((c) => c.kind === "MANAGER_SEND" && c.ownerUserId === props.userId);
  const google = (purpose: "CLIENT" | "SEND") => `/api/connections/google/start?clientId=${encodeURIComponent(props.clientId)}&purpose=${purpose}`;

  return (
    <div className="flex flex-col gap-5" data-testid="connections-screen">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-app-text-secondary">{props.clientName} · תיק הלקוח</span>
          <h1 className="text-xl font-medium text-app-text-primary">חיבורים</h1>
          <p className="text-sm text-app-text-secondary">מערכות של הלקוח שהנהלים שלו קוראים מהן או כותבים אליהן. כל שימוש נרשם ביומן.</p>
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
                <strong className="text-base font-medium text-app-text-primary">{KIND[c.kind]}</strong>
                <span className="rounded-full bg-app-success-soft px-2.5 py-0.5 text-xs font-medium text-app-success">מחובר</span>
              </div>
              <span className="text-sm text-app-text-secondary" dir="ltr">
                {c.account}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {scopeTags(c).map((t) => (
                  <span key={t} className="rounded-md bg-app-neutral-soft px-2 py-0.5 text-xs text-app-text-secondary">
                    {t}
                  </span>
                ))}
              </div>
              <span className="text-xs text-app-text-secondary">
                {c.consentText ?? "אישור לא נרשם"} · {day(c.connectedAt)}
                {c.connectedByName ? ` · חיבר: ${c.connectedByName}` : ""}
              </span>
              <span className="text-xs text-app-text-secondary">{c.usedBy ? `בשימוש ב-${c.usedBy} נהלים` : "עוד לא בשימוש בנוהל"}</span>
              {c.kind === "GOOGLE_OAUTH" && (
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  מזהה תיקייה בדרייב, לבדיקה (רשות)
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
                    בדיקת חיבור
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(c.usedBy ? `החיבור בשימוש ב-${c.usedBy} נהלים, והם ייעצרו בצומת שמשתמש בו. לנתק?` : "לנתק את החיבור ולבטל את ההרשאה?")) return;
                      start(async () => {
                        const r = await disconnectAction(props.clientId, c.id);
                        setMsg({ id: null, text: r.error ?? r.ok ?? "", error: !!r.error });
                      });
                    }}
                    className="h-11 flex-1 rounded-[10px] border border-app-border bg-white text-sm text-app-error"
                  >
                    ניתוק
                  </button>
                </div>
              )}
            </li>
          ))}

        {props.mayManage && (
          <li className="flex flex-col gap-3 rounded-[14px] border border-dashed border-app-border-strong bg-white p-5">
            <strong className="text-base font-medium text-app-text-primary">חיבור חדש</strong>
            <span className="text-sm text-app-text-secondary">איך הלקוח מתחבר:</span>
            {props.googleReady ? (
              <a href={google("CLIENT")} className="flex min-h-16 flex-col gap-0.5 rounded-[10px] border-2 border-app-accent px-3.5 py-2.5 text-start text-app-text-primary">
                <span className="text-sm font-medium">חיבור דרך Google (מומלץ)</span>
                <span className="text-xs text-app-text-secondary">הלקוח מאשר במסך של Google. מייל ודרייב.</span>
              </a>
            ) : (
              <p className="rounded-[10px] bg-app-neutral-soft px-3 py-2 text-xs text-app-text-secondary">חיבור דרך Google עוד לא מוגדר בסביבה הזו.</p>
            )}
            <details className="rounded-[10px] border border-app-border px-3.5 py-2.5">
              <summary className="cursor-pointer text-sm font-medium text-app-text-primary">שם משתמש וסיסמת אפליקציה</summary>
              <form action={formAction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="clientId" value={props.clientId} />
                <p className="text-xs text-app-text-secondary">מייל בלבד. נשמר בכספת. סיסמת אפליקציה של Google דורשת אימות דו-שלבי בחשבון.</p>
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  כתובת המייל
                  <input name="account" dir="ltr" autoComplete="off" className={INPUT} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  סיסמת אפליקציה
                  <input name="appPassword" type="password" dir="ltr" autoComplete="new-password" className={INPUT} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-app-text-secondary">
                  מי אצל הלקוח מסר את הגישה, ומתי
                  <input name="consentText" className={INPUT} />
                </label>
                {formState?.error && <p className="text-xs text-app-error">{formState.error}</p>}
                {formState?.ok && <p className="text-xs text-app-success">{formState.ok}</p>}
                <button type="submit" disabled={formPending} className="h-11 rounded-[10px] bg-app-surface-nav text-sm font-medium text-app-surface-page">
                  שמירת החיבור
                </button>
              </form>
            </details>
          </li>
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-app-border bg-white px-4 py-3.5">
        <strong className="text-sm font-medium text-app-text-primary">שליחה</strong>
        <span className="text-sm text-app-text-secondary">מיילים שהנהלים של הלקוח הזה שולחים יוצאים מהתיבה של מנהל התיק.</span>
        {mine ? (
          <span className="ms-auto rounded-full bg-app-success-soft px-2.5 py-0.5 text-xs font-medium text-app-success" dir="auto">
            התיבה שלך מחוברת: {mine.account}
          </span>
        ) : props.mayManage && props.googleReady ? (
          <a href={google("SEND")} className="ms-auto rounded-[10px] border border-app-border px-3 py-2 text-sm text-app-text-primary">
            חיבור התיבה שלי לשליחה
          </a>
        ) : (
          <span className="ms-auto text-xs text-app-text-tertiary">התיבה שלך לא מחוברת.</span>
        )}
      </div>

      {props.aiExcluded && (
        <p className="rounded-[10px] bg-app-info-soft px-4 py-3 text-sm text-app-info">
          הלקוח מסומן &quot;בלי AI&quot;: בדיקות פשוטות (הגיעה תשובה, יש קובץ) עדיין רצות, אבל קלוד לא קורא דרך החיבורים.
        </p>
      )}
    </div>
  );
}

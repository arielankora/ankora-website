import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { alertAdmins } from "./admin-alert";
import { reportIssue } from "@/lib/system-issues";

// An employee connects their own WhatsApp (24.11.2026, Ariel: "two steps,
// connect and one button"). Until now it took four people-steps: a link made
// by hand in Unipile's dashboard, the number connected in the setup screen,
// the number added to the webhook, and "התחל לשמור". Now:
//   1. "חיבור ה-WhatsApp שלי": Ankora asks Unipile for a Hosted Auth link
//      and sends the employee to it; they scan the QR; Unipile sends them
//      back here, and the number is connected as theirs and added to the
//      webhook, with nobody else involved.
//   2. "הפעלת שמירה": one button. The "לא לשמור" list stays open afterwards.
// The same button reconnects a number whose WhatsApp was disconnected.
//
// The way back from Unipile carries only an account id, which anyone could
// type into a URL. So it counts only together with a signed, short-lived
// cookie set when this user pressed the button (ConnectIntent), and a new
// number must be a WhatsApp account no one has connected yet.

const BASE_URL = "https://api.unipile.com/v2";
const TIMEOUT_MS = 15_000;
export const CONNECT_COOKIE = "ankora_wa_connect";
export const CONNECT_MINUTES = 30;

export type ConnectIntent = {
  userId: string;
  mode: "new" | "reconnect";
  /// The number's account, when reconnecting.
  accountId: string | null;
  issuedAt: number;
};

function intentKey(): string {
  const key = process.env.AUTH_SECRET?.trim();
  if (!key) throw new Error("AUTH_SECRET is not set");
  return key;
}

function mac(body: string, key: string): string {
  return crypto.createHmac("sha256", key).update(`wa-connect.${body}`).digest("base64url");
}

export function signIntent(intent: ConnectIntent, key = intentKey()): string {
  const body = Buffer.from(JSON.stringify(intent)).toString("base64url");
  return `${body}.${mac(body, key)}`;
}

/// The intent, when the cookie is ours, untouched and not older than the link.
export function readIntent(value: string | undefined, now = Date.now(), key = intentKey()): ConnectIntent | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = mac(body, key);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const intent = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ConnectIntent;
    if (typeof intent.userId !== "string" || typeof intent.issuedAt !== "number") return null;
    if (now - intent.issuedAt > CONNECT_MINUTES * 60_000 || intent.issuedAt > now + 60_000) return null;
    return intent;
  } catch {
    return null;
  }
}

function apiKey(): string {
  const key = readPocConfig().apiKey;
  if (!key) throw new Error("UNIPILE_API_KEY is not set");
  return key;
}

async function unipile<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "X-API-KEY": apiKey(),
      accept: "application/json",
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // The body can echo identifiers; only the status is kept.
  if (!response.ok) throw new Error(`Unipile ${init?.method ?? "GET"} ${path.split("/")[1]} answered ${response.status}`);
  return (await response.json()) as T;
}

export type AccountState = { provider: string; status: string; createdAt: string | null; userId: string | null };

export async function readAccount(accountId: string): Promise<AccountState> {
  const a = await unipile<{ provider?: unknown; status?: unknown; created_at?: unknown; user_id?: unknown }>(`/accounts/${accountId}`);
  return {
    provider: typeof a.provider === "string" ? a.provider : "",
    status: typeof a.status === "string" ? a.status : "",
    createdAt: typeof a.created_at === "string" ? a.created_at : null,
    /// For WhatsApp, the number itself ("972553311522").
    userId: typeof a.user_id === "string" ? a.user_id : null,
  };
}

/// "running" is the only state in which messages arrive (Unipile v2:
/// running, errored, disconnected, degraded, partial).
export function needsReconnect(status: string): boolean {
  return status === "disconnected" || status === "partial";
}

/// The employee's own number, if they have one.
export function ownChannel(userId: string) {
  return prisma.commsChannel.findFirst({ where: { ownerUserId: userId }, orderBy: { createdAt: "asc" } });
}

/// Step 1: the Hosted Auth link, and the cookie that must come back with it.
export async function createConnectLink(
  user: { id: string },
  redirectUri: string,
  now = Date.now(),
): Promise<{ link: string; cookie: string }> {
  const channel = await ownChannel(user.id);
  const expires_on = new Date(now + CONNECT_MINUTES * 60_000).toISOString();
  const body = channel
    ? { account_id: channel.accountId, expires_on, redirect_uri: redirectUri }
    : { providers: ["whatsapp"], expires_on, redirect_uri: redirectUri };
  const { link } = await unipile<{ link: string }>("/auth/link", { method: "POST", body });
  const intent: ConnectIntent = { userId: user.id, mode: channel ? "reconnect" : "new", accountId: channel?.accountId ?? null, issuedAt: now };
  return { link, cookie: signIntent(intent) };
}

export type ConnectResult = "connected" | "reconnected" | "expired" | "failed" | "wrong-provider" | "taken";

/// Step 1, the way back: connect the number as the employee's own.
export async function completeConnect(
  user: { id: string; name: string | null; email: string },
  intent: ConnectIntent | null,
  query: { accountId: string | null; errorType: string | null },
): Promise<ConnectResult> {
  if (!intent || intent.userId !== user.id) return "expired";
  if (query.errorType || !query.accountId || !/^acc_[A-Za-z0-9]+$/.test(query.accountId)) return "failed";
  const accountId = query.accountId;
  const account = await readAccount(accountId);
  if (account.provider !== "whatsapp") return "wrong-provider";

  if (intent.mode === "reconnect") {
    if (accountId !== intent.accountId) return "failed";
    const channel = await prisma.commsChannel.findUnique({ where: { accountId } });
    if (!channel || channel.ownerUserId !== user.id) return "failed";
    await recordAudit({ actorId: user.id, action: "comms_channel.reconnected", entityType: "CommsChannel", entityId: channel.id });
    return "reconnected";
  }

  const existing = await prisma.commsChannel.findUnique({ where: { accountId } });
  if (existing) return existing.ownerUserId === user.id ? "connected" : "taken";
  // A new number is one Unipile linked after the button was pressed, so an
  // account id typed into the URL cannot claim an older account.
  if (account.createdAt && Date.parse(account.createdAt) < intent.issuedAt - 5 * 60_000) return "taken";

  const channel = await prisma.commsChannel.create({ data: { accountId, ownerUserId: user.id, excludedViewerIds: [] } });
  await recordAudit({
    actorId: user.id,
    action: "comms_channel.connected",
    entityType: "CommsChannel",
    entityId: channel.id,
    after: { ownerUserId: user.id, selfConnected: true },
  });
  const owner = user.name || user.email;
  try {
    await addAccountToWebhook(accountId);
  } catch (err) {
    // The admins hear of it below, in words; the log keeps the error.
    console.warn("self-connect: could not add the account to the webhook", { channelId: channel.id }, err);
    await alertAdmins({
      type: "webhook_account_failed",
      subjectId: channel.id,
      entityType: "CommsChannel",
      render: (t) => ({
        title: t("webhookAccountFailed.title", { owner }),
        body: t("webhookAccountFailed.body", { owner, error: err instanceof Error ? err.message : String(err) }),
      }),
    });
  }
  await alertAdmins({
    type: "channel_self_connected",
    subjectId: channel.id,
    entityType: "CommsChannel",
    render: (t) => ({ title: t("selfConnected.title", { owner }), body: t("selfConnected.body", { owner }) }),
  });
  return "connected";
}

/// The webhook sends messages only from the accounts on its list
/// (24.11.2026: Hadas's and Anna's numbers were missing from it, so their
/// messages arrived only with the nightly run). An empty list means every
/// account, so there is nothing to add.
/// The production webhook ("אנקורה: הקלטות שיחה מ-aloha@"). Not a secret; an
/// environment value overrides it.
const WEBHOOK_ENDPOINT_ID = "we_01m6b2fpnneh19j4gvbc6rky7a";

export async function addAccountToWebhook(accountId: string): Promise<void> {
  const id = process.env.UNIPILE_WEBHOOK_ENDPOINT_ID?.trim() || WEBHOOK_ENDPOINT_ID;
  if (!/^we_[A-Za-z0-9]+$/.test(id)) throw new Error("UNIPILE_WEBHOOK_ENDPOINT_ID is not valid");
  const endpoint = await unipile<{ account_ids?: unknown }>(`/webhooks/endpoints/${id}`);
  const ids = Array.isArray(endpoint.account_ids) ? endpoint.account_ids.filter((a): a is string => typeof a === "string") : [];
  const next = withAccount(ids, accountId);
  if (next) await unipile(`/webhooks/endpoints/${id}`, { method: "PATCH", body: { account_ids: next } });
}

/// For a number a manager connects on the setup screen (27.11.2026): add it
/// to the webhook, and when that fails, a system issue instead of silence.
export async function addToWebhookOrReport(accountId: string, channelId: string): Promise<void> {
  try {
    await addAccountToWebhook(accountId);
  } catch (err) {
    await reportIssue({
      area: "comms",
      key: `webhook-account:${channelId}`,
      title: "מספר WhatsApp חובר, אבל לא נוסף ל-webhook ב-Unipile: הודעות ממנו לא ייקלטו בזמן אמת",
      error: err,
      severity: "CRITICAL",
    });
  }
}

/// The webhook's new account list, or null when nothing has to change.
export function withAccount(ids: readonly string[], accountId: string): string[] | null {
  if (ids.length === 0 || ids.includes(accountId)) return null;
  return [...ids, accountId];
}

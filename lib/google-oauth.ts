import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Google OAuth for client connections (ADR 0001 section 24, task
// cmvtivumj000pjs08q9qj4t67). The client signs in on Google's own screen;
// Ankora never sees a password. The client id and secret are environment
// variables set in Vercel by a person, never in the repository or a chat.
//
// Scopes are the narrowest that work (24.2):
// - CLIENT: know that a reply arrived in a thread (gmail.metadata), know
//   that a file arrived in a folder (drive.metadata.readonly), and write the
//   files the procedure creates (drive.file). Found while building
//   (4.11.2026): drive.file alone cannot see files the client adds to a
//   folder, so "a file arrived" needs drive.metadata.readonly. Both Gmail
//   and Drive metadata scopes are restricted: Google verification before a
//   real client (24.6).
// - SEND: the account manager's own mailbox, send only.

export type OAuthPurpose = "CLIENT" | "SEND";

/// The cookie that ties a consent round trip to the browser that started it.
export const NONCE_COOKIE = "ankora_gconn_nonce";

export const SCOPES: Record<OAuthPurpose, string[]> = {
  CLIENT: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.metadata",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
  SEND: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
};

export function googleOAuthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function redirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/connections/google/callback`;
}

/// What the callback needs to trust: who started it, for which client, for
/// what, and when. Signed with AUTH_SECRET; the nonce is also in a cookie,
/// so a link someone else started cannot be finished in this browser.
export type OAuthState = { clientId: string; userId: string; purpose: OAuthPurpose; nonce: string; exp: number };

const key = () => {
  const k = process.env.AUTH_SECRET;
  if (!k) throw new Error("AUTH_SECRET is not set.");
  return k;
};

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export function signState(state: OAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  const mac = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function readState(token: string, nonce: string | undefined, now = Date.now()): OAuthState | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let state: OAuthState;
  try {
    state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return null;
  }
  if (!nonce || state.nonce !== nonce || state.exp < now) return null;
  if (state.purpose !== "CLIENT" && state.purpose !== "SEND") return null;
  return state;
}

export function authUrl(input: { clientId: string; origin: string; purpose: OAuthPurpose; state: string }): string {
  const q = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: redirectUri(input.origin),
    response_type: "code",
    scope: SCOPES[input.purpose].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export type TokenResult = { refreshToken: string | null; accessToken: string; scopes: string[]; email: string | null };

/// The code from the callback, exchanged for tokens, with the account's
/// address from the ID token Google signed in the same response.
export async function exchangeCode(input: { code: string; origin: string }): Promise<TokenResult> {
  const cfg = googleOAuthConfig();
  if (!cfg) throw new Error("החיבור ל-Google לא מוגדר.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: input.code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri(input.origin), grant_type: "authorization_code" }),
  });
  if (!res.ok) throw new Error("Google לא אישר את החיבור. נסו שוב.");
  const json = (await res.json()) as { access_token: string; refresh_token?: string; scope?: string; id_token?: string };
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? null, scopes: (json.scope ?? "").split(" ").filter(Boolean), email: emailFromIdToken(json.id_token) };
}

/// The address in an ID token that came straight from Google's token
/// endpoint over TLS, in the same response as the tokens: read, not
/// verified again (Google's guidance for this exact case).
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function accessTokenFrom(refreshToken: string): Promise<string> {
  const cfg = googleOAuthConfig();
  if (!cfg) throw new Error("החיבור ל-Google לא מוגדר.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error("החיבור ל-Google לא פעיל יותר. צריך לחבר מחדש.");
  return ((await res.json()) as { access_token: string }).access_token;
}

/// Disconnecting at Google too, not only here. Best effort: a token Google
/// already dropped is gone either way.
export async function revokeToken(token: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

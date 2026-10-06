"use client";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

// The browser half of the vault's passkeys. Two round trips each: ask the
// server for a challenge, let the device sign it (Touch ID), send the
// answer back. Nothing here is stored; the device keeps the private key.

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Not JSON: treated as a refusal below.
  }
  return { status: res.status, data };
}

export type WebAuthnResult = { ok: true } | { ok: false; message: string };

/// The device's own "cancelled" is not an error worth alarming anyone
/// about; it is a person who changed their mind.
function cancelled(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

export async function verifyWithPasskey(): Promise<WebAuthnResult> {
  const opts = await post("/api/step-up/passkey/options", {});
  if (opts.status !== 200) return { ok: false, message: opts.data?.message ?? "לא ניתן להתחיל אימות כרגע." };
  let response;
  try {
    response = await startAuthentication({ optionsJSON: opts.data });
  } catch (err) {
    return { ok: false, message: cancelled(err) ? "האימות בוטל." : "המכשיר לא השלים את האימות." };
  }
  const done = await post("/api/step-up/passkey/verify", { response });
  if (done.status === 200) return { ok: true };
  return { ok: false, message: done.data?.message ?? "האימות נכשל." };
}

export async function addPasskey(password: string, name: string): Promise<WebAuthnResult> {
  const opts = await post("/api/passkeys/register/options", { password });
  if (opts.status !== 200) return { ok: false, message: opts.data?.message ?? "לא ניתן להוסיף passkey כרגע." };
  let response;
  try {
    response = await startRegistration({ optionsJSON: opts.data });
  } catch (err) {
    if ((err as { name?: string })?.name === "InvalidStateError") {
      return { ok: false, message: "ה-passkey של המכשיר הזה כבר רשום." };
    }
    return { ok: false, message: cancelled(err) ? "ההוספה בוטלה." : "המכשיר לא השלים את ההוספה." };
  }
  const done = await post("/api/passkeys/register/verify", { response, name });
  if (done.status === 200) return { ok: true };
  return { ok: false, message: done.data?.message ?? "ה-passkey לא נשמר." };
}

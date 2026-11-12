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

/// ADR 0006: a failure the server explained comes with its `message`,
/// already in the reader's language. One that happened in the browser (a
/// cancelled prompt, no answer from the server) comes with a `reason`
/// instead, and the screen words it from its own dictionary; see
/// webauthnFailureText below.
export type WebAuthnFailure =
  | "verify_unavailable"
  | "verify_cancelled"
  | "verify_incomplete"
  | "verify_failed"
  | "add_unavailable"
  | "add_already_registered"
  | "add_cancelled"
  | "add_incomplete"
  | "add_not_saved";

export type WebAuthnResult = { ok: true } | { ok: false; message?: string; reason: WebAuthnFailure };

/// The sentence for a failed result: the server's, or the dictionary's.
export function webauthnFailureText(r: { message?: string; reason: WebAuthnFailure }, t: (key: WebAuthnFailure) => string): string {
  return r.message ?? t(r.reason);
}

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
  if (opts.status !== 200) return { ok: false, message: opts.data?.message, reason: "verify_unavailable" };
  let response;
  try {
    response = await startAuthentication({ optionsJSON: opts.data });
  } catch (err) {
    return { ok: false, reason: cancelled(err) ? "verify_cancelled" : "verify_incomplete" };
  }
  const done = await post("/api/step-up/passkey/verify", { response });
  if (done.status === 200) return { ok: true };
  return { ok: false, message: done.data?.message, reason: "verify_failed" };
}

export async function addPasskey(password: string, name: string): Promise<WebAuthnResult> {
  const opts = await post("/api/passkeys/register/options", { password });
  if (opts.status !== 200) return { ok: false, message: opts.data?.message, reason: "add_unavailable" };
  let response;
  try {
    response = await startRegistration({ optionsJSON: opts.data });
  } catch (err) {
    if ((err as { name?: string })?.name === "InvalidStateError") {
      return { ok: false, reason: "add_already_registered" };
    }
    return { ok: false, reason: cancelled(err) ? "add_cancelled" : "add_incomplete" };
  }
  const done = await post("/api/passkeys/register/verify", { response, name });
  if (done.status === 200) return { ok: true };
  return { ok: false, message: done.data?.message, reason: "add_not_saved" };
}

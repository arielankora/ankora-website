"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Fingerprint } from "lucide-react";
import { useTranslations } from "next-intl";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import {
  enrollFinishAction,
  enrollOptionsAction,
  passkeyLoginOptionsAction,
  passkeyLoginVerifyAction,
  redeemDeviceCodeAction,
} from "./actions";

// The second step of signing in (lib/app-auth/second-factor.ts). The
// password, or the emailed link, was right; now the device answers with
// a fingerprint, a face or the device PIN.
//
// The prompt opens on a click, not on load: Safari refuses to start a
// passkey ceremony without a user gesture, and a button that says what
// is about to happen is clearer anyway.
//
// A device with no passkey of its own (a phone, when the passkey was made
// on the Mac) cannot answer; iOS then offers only a QR code for another
// device to scan. "This is a new device" takes a code from a device that
// is already signed in, and then enrols this one (lib/app-auth/device-
// link.ts).

const BUTTON =
  "mt-5 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-app-accent text-[15px] font-medium text-app-text-primary disabled:opacity-50";

function cancelled(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

export function SecondFactorStep({
  step,
  token,
  callbackUrl,
  restartHref,
}: {
  step: "passkey" | "enroll";
  token: string;
  callbackUrl: string;
  restartHref: string;
}) {
  const t = useTranslations("auth.secondFactor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An error that ended the pending sign-in: the only way on is back to
  // the first step.
  const [expired, setExpired] = useState(false);
  // What this screen is doing now: the passkey answer, typing a code from
  // a signed-in device, or enrolling this device.
  const [mode, setMode] = useState<"passkey" | "code" | "enroll">(step);
  const [linked, setLinked] = useState(false);

  async function redeem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = (e.currentTarget.elements.namedItem("code") as HTMLInputElement).value;
    setBusy(true);
    setError(null);
    const r = await redeemDeviceCodeAction(token, code);
    setBusy(false);
    if (r.ok) {
      setLinked(true);
      return setMode("enroll");
    }
    if (!r.retry) setExpired(true);
    setError(r.error);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const opts = await passkeyLoginOptionsAction(token);
    if (!opts.ok) {
      setBusy(false);
      setExpired(true);
      return setError(opts.error);
    }
    let response;
    try {
      response = await startAuthentication({ optionsJSON: opts.options as any });
    } catch (err) {
      setBusy(false);
      return setError(
        cancelled(err) ? t("verifyCancelled") : t("verifyIncomplete"),
      );
    }
    // On success the action redirects, and this component is gone.
    const done = await passkeyLoginVerifyAction(token, response, callbackUrl);
    setBusy(false);
    if (done?.error) {
      setExpired(true);
      setError(done.error);
    }
  }

  async function enroll(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = (e.currentTarget.elements.namedItem("name") as HTMLInputElement).value;
    setBusy(true);
    setError(null);
    const opts = await enrollOptionsAction(token);
    if (!opts.ok) {
      setBusy(false);
      setExpired(true);
      return setError(opts.error);
    }
    let response;
    try {
      response = await startRegistration({ optionsJSON: opts.options as any });
    } catch (err) {
      setBusy(false);
      return setError(cancelled(err) ? t("enrollCancelled") : t("enrollIncomplete"));
    }
    const done = await enrollFinishAction(token, response, name, callbackUrl);
    setBusy(false);
    if (done?.error) {
      setExpired(true);
      setError(done.error);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-app-text-primary">
        <Fingerprint size={20} strokeWidth={1.6} />
        <h2 className="text-[15px] font-medium">
          {mode === "passkey" ? t("titlePasskey") : mode === "code" ? t("titleCode") : t("titleEnroll")}
        </h2>
      </div>

      {mode === "passkey" ? (
        <p className="mt-2 text-[13.5px] leading-relaxed text-app-text-secondary">
          {t("introPasskey")}
        </p>
      ) : mode === "code" ? (
        <p className="mt-2 text-[13.5px] leading-relaxed text-app-text-secondary">
          {t("introCode")}
        </p>
      ) : linked ? (
        <p className="mt-2 text-[13.5px] leading-relaxed text-app-text-secondary">
          {t("introLinked")}
        </p>
      ) : (
        <p className="mt-2 text-[13.5px] leading-relaxed text-app-text-secondary">
          {t("introEnroll")}
        </p>
      )}

      {error && (
        <p className="mt-3.5 rounded-[10px] border border-app-error/30 bg-app-error-soft px-3 py-2.5 text-xs text-app-error">{error}</p>
      )}

      {expired ? (
        <Link href={restartHref} className={BUTTON}>
          {t("backToSignIn")}
        </Link>
      ) : mode === "passkey" ? (
        <>
          <button type="button" onClick={verify} disabled={busy} className={BUTTON}>
            <Fingerprint size={17} strokeWidth={1.75} />
            {busy ? t("waitingForDevice") : t("verifyOnDevice")}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode("code");
            }}
            className="mt-4 block w-full text-center text-[13px] text-app-text-secondary underline-offset-4 hover:underline"
          >
            {t("newDevice")}
          </button>
        </>
      ) : mode === "code" ? (
        // Keyed: without it React reuses the code form's <input> for the
        // name field below, and the typed code becomes the device's name.
        <form key="code" onSubmit={redeem}>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs text-app-text-secondary">{t("codeLabel")}</span>
            <input
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              required
              dir="ltr"
              placeholder="123456"
              className="w-full rounded-[10px] border border-app-border-strong bg-white px-3.5 py-3 text-center text-lg tracking-[0.3em] text-app-text-primary outline-none focus:border-gold"
            />
          </label>
          <button type="submit" disabled={busy} className={BUTTON}>
            {busy ? t("checking") : t("continue")}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode("passkey");
            }}
            className="mt-4 block w-full text-center text-[13px] text-app-text-secondary underline-offset-4 hover:underline"
          >
            {t("backToVerify")}
          </button>
        </form>
      ) : (
        <form key="enroll" onSubmit={enroll}>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs text-app-text-secondary">{t("deviceNameLabel")}</span>
            <input
              name="name"
              type="text"
              required
              maxLength={60}
              placeholder={linked ? t("deviceNamePhone") : t("deviceNameComputer")}
              className="w-full rounded-[10px] border border-app-border-strong bg-white px-3.5 py-3 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </label>
          <button type="submit" disabled={busy} className={BUTTON}>
            <Fingerprint size={17} strokeWidth={1.75} />
            {busy ? t("waitingForDevice") : t("enrollAndSignIn")}
          </button>
        </form>
      )}
    </div>
  );
}

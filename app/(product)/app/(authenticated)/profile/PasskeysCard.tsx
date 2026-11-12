"use client";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, Smartphone } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import { useFormatter, useTranslations } from "next-intl";
import { addPasskey, passkeysSupported, webauthnFailureText } from "@/components/app/vault/webauthn-client";
import { deviceLinkIssueAction, deviceLinkOptionsAction, removePasskeyAction, setLoginPasskeyRequiredAction } from "./actions";

// "Passkey (Touch ID)". For Ankora staff: the second step of every sign-in
// and the identity check before a client's login is shown in "מערכות
// וגישות". For clients: an opt-in second step at sign-in
// (lib/app-auth/second-factor.ts). Adding one asks for the Ankora password
// first; see lib/app-auth/passkeys.ts for why.

type Row = { id: string; name: string; createdAt: string; lastUsedAt: string | null; backedUp: boolean };

const INPUT =
  "mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";

export function PasskeysCard({
  passkeys,
  required,
  audience,
  loginRequired,
}: {
  passkeys: Row[];
  required: boolean;
  audience: "staff" | "client";
  /// Staff: enforced on this deployment. Client: their own choice.
  loginRequired: boolean;
}) {
  const t = useTranslations("profile.passkeys");
  const tWebauthn = useTranslations("auth.webauthn");
  const format = useFormatter();
  const [toggling, setToggling] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => setSupported(passkeysSupported()), []);

  // "Add a device" (lib/app-auth/device-link.ts): a passkey check here,
  // then a six-digit code to type on the new device after its password.
  const [link, setLink] = useState<{ code: string; until: string } | null>(null);
  const [linking, setLinking] = useState(false);

  async function onLink() {
    setLinking(true);
    setError(null);
    const opts = await deviceLinkOptionsAction();
    if (!opts.ok) {
      setLinking(false);
      return setError(opts.error);
    }
    let response;
    try {
      response = await startAuthentication({ optionsJSON: opts.options as any });
    } catch {
      setLinking(false);
      return setError(tWebauthn("verify_cancelled"));
    }
    const r = await deviceLinkIssueAction(response);
    setLinking(false);
    if (!r.ok) return setError(r.error);
    // ADR 0006: in the person's locale and time zone (i18n/request.ts).
    const until = format.dateTime(new Date(r.expiresAt), { hour: "2-digit", minute: "2-digit" });
    setLink({ code: r.code, until });
  }

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value;
    setBusy(true);
    setError(null);
    const r = await addPasskey(password, name);
    setBusy(false);
    form.reset();
    if (!r.ok) return setError(webauthnFailureText(r, tWebauthn));
    setAdding(false);
    router.refresh();
  }

  return (
    <div id="passkeys" className="rounded-2xl border border-app-border bg-white p-6">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-app-text-primary">
        <Fingerprint size={16} strokeWidth={1.75} />
        Passkey (Touch ID)
      </h2>
      <p className="mt-1 text-xs text-app-text-secondary">
        {audience === "staff" ? t("introStaff") : t("introClient")}
      </p>
      {audience === "staff" && required && passkeys.length === 0 && (
        <p className="mt-3 rounded-lg bg-cream-dim p-3 text-xs text-app-text-primary">
          {t("requiredNote")}
        </p>
      )}
      {passkeys.length === 1 && (
        <p className="mt-3 rounded-lg bg-cream-dim p-3 text-xs text-app-text-primary">
          {t("secondDeviceNote")}
        </p>
      )}

      {passkeys.length > 0 && (
        <ul className="mt-4 divide-y divide-app-border">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p dir="auto" className="truncate text-sm text-app-text-primary">{p.name}</p>
                <p className="text-xs text-app-text-tertiary">
                  {t("added", { date: p.createdAt })}
                  {" · "}
                  {p.lastUsedAt ? t("lastUsed", { date: p.lastUsedAt }) : t("neverUsed")}
                  {p.backedUp ? ` · ${t("backedUp")}` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await removePasskeyAction(p.id);
                    if (r.error) setError(r.error);
                    else router.refresh();
                  })
                }
                className="shrink-0 text-xs text-app-text-tertiary hover:text-app-error"
              >
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported && passkeys.length > 0 && (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-sm text-app-text-primary">
            <Smartphone size={15} strokeWidth={1.75} />
            {t("addDevice")}
          </p>
          <p className="mt-1 text-xs text-app-text-secondary">
            {t("addDeviceHint")}
          </p>
          {link ? (
            <div className="mt-3 rounded-lg bg-cream-dim p-4 text-center">
              <p dir="ltr" className="font-mono text-2xl tracking-[0.35em] text-app-text-primary">
                {link.code.slice(0, 3)} {link.code.slice(3)}
              </p>
              <p className="mt-1.5 text-xs text-app-text-secondary">{t("codeValidUntil", { time: link.until })}</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={onLink}
              disabled={linking}
              className="mt-3 rounded-full bg-app-accent px-5 py-2 text-sm font-medium text-app-text-primary disabled:opacity-50"
            >
              {linking ? t("waiting") : t("createCode")}
            </button>
          )}
        </div>
      )}
      {!supported ? (
        <p className="mt-4 text-xs text-app-text-secondary">{t("unsupported")}</p>
      ) : adding ? (
        <form onSubmit={onAdd} className="mt-4 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-app-text-secondary" htmlFor="pk-name">{t("deviceName")}</label>
            <input id="pk-name" name="name" maxLength={60} placeholder="MacBook" className={INPUT} />
          </div>
          <div>
            <label className="block text-xs font-medium text-app-text-secondary" htmlFor="pk-pass">{t("yourPassword")}</label>
            <input id="pk-pass" name="password" type="password" required autoComplete="current-password" className={INPUT} />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-app-accent px-5 py-2 text-sm font-medium text-app-text-primary disabled:opacity-50"
            >
              {busy ? t("waiting") : t("continueTouchId")}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="px-3 text-sm text-app-text-secondary">
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={
            passkeys.length > 0
              ? "mt-4 block text-xs text-app-text-tertiary underline-offset-4 hover:underline"
              : "mt-4 rounded-full border border-app-border px-4 py-2 text-sm text-app-text-primary hover:bg-app-surface-sunken"
          }
        >
          {passkeys.length > 0 ? t("registerAnother") : t("addPasskey")}
        </button>
      )}
      {audience === "client" && passkeys.length > 0 && (
        <div className="mt-5 border-t border-app-border pt-4">
          <p className="text-sm text-app-text-primary">
            {t.rich("loginRequired", {
              state: () => <span className="font-medium">{loginRequired ? t("on") : t("off")}</span>,
            })}
          </p>
          {toggling ? (
            <form
              className="mt-3 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const password = (e.currentTarget.elements.namedItem("password") as HTMLInputElement).value;
                setError(null);
                start(async () => {
                  const r = await setLoginPasskeyRequiredAction(!loginRequired, password);
                  if (r.error) return setError(r.error);
                  setToggling(false);
                  router.refresh();
                });
              }}
            >
              <div>
                <label className="block text-xs font-medium text-app-text-secondary" htmlFor="lp-pass">{t("yourPassword")}</label>
                <input id="lp-pass" name="password" type="password" required autoComplete="current-password" className={INPUT} />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-full bg-app-accent px-5 py-2 text-sm font-medium text-app-text-primary disabled:opacity-50"
                >
                  {loginRequired ? t("turnOff") : t("turnOn")}
                </button>
                <button type="button" onClick={() => setToggling(false)} className="px-3 text-sm text-app-text-secondary">
                  {t("cancel")}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setToggling(true)}
              className="mt-3 rounded-full border border-app-border px-4 py-2 text-sm text-app-text-primary hover:bg-app-surface-sunken"
            >
              {loginRequired ? t("turnOffTwoStep") : t("turnOnTwoStep")}
            </button>
          )}
        </div>
      )}
      {audience === "staff" && loginRequired && (
        <p className="mt-4 text-xs text-app-text-tertiary">{t("staffAlwaysOn")}</p>
      )}
      {error && <p className="mt-3 text-xs text-app-error">{error}</p>}
    </div>
  );
}

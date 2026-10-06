"use client";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { addPasskey, passkeysSupported } from "@/components/app/vault/webauthn-client";
import { removePasskeyAction } from "./actions";

// "Passkey (Touch ID)": the identity check before a client's login is
// shown in "מערכות וגישות" (claude/credentials-vault-spec-2026-10-06.md,
// phase 1a). Adding one asks for the Ankora password first; see
// lib/app-auth/passkeys.ts for why.

type Row = { id: string; name: string; createdAt: string; lastUsedAt: string | null; backedUp: boolean };

const INPUT =
  "mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold";

export function PasskeysCard({ passkeys, required }: { passkeys: Row[]; required: boolean }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => setSupported(passkeysSupported()), []);

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
    if (!r.ok) return setError(r.message);
    setAdding(false);
    router.refresh();
  }

  return (
    <div id="passkeys" className="rounded-2xl border border-lineDark bg-white p-6">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-appNavy">
        <Fingerprint size={16} strokeWidth={1.75} />
        Passkey (Touch ID)
      </h2>
      <p className="mt-1 text-xs text-appNavy/60">
        אימות זהות לפני צפייה בפרטי גישה של לקוחות, בטביעת אצבע או בזיהוי פנים. המפתח נשאר במכשיר שלך.
      </p>
      {required && passkeys.length === 0 && (
        <p className="mt-3 rounded-lg bg-cream-dim p-3 text-xs text-appNavy/80">
          כדי לצפות בגישות במערכות וגישות צריך להגדיר passkey אחד לפחות.
        </p>
      )}

      {passkeys.length > 0 && (
        <ul className="mt-4 divide-y divide-lineDark/70">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-appNavy">{p.name}</p>
                <p className="text-xs text-appNavy/50">
                  נוסף {p.createdAt}
                  {p.lastUsedAt ? ` · שימוש אחרון ${p.lastUsedAt}` : " · עוד לא בשימוש"}
                  {p.backedUp ? " · מגובה בחשבון המכשיר" : ""}
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
                className="shrink-0 text-xs text-appNavy/50 hover:text-error"
              >
                הסרה
              </button>
            </li>
          ))}
        </ul>
      )}

      {!supported ? (
        <p className="mt-4 text-xs text-appNavy/60">הדפדפן הזה לא תומך ב-passkey.</p>
      ) : adding ? (
        <form onSubmit={onAdd} className="mt-4 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-appNavy/60" htmlFor="pk-name">שם למכשיר</label>
            <input id="pk-name" name="name" maxLength={60} placeholder="MacBook" className={INPUT} />
          </div>
          <div>
            <label className="block text-xs font-medium text-appNavy/60" htmlFor="pk-pass">הסיסמה שלך לאנקורה</label>
            <input id="pk-pass" name="password" type="password" required autoComplete="current-password" className={INPUT} />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-gold-gradient px-5 py-2 text-sm font-medium text-navy disabled:opacity-50"
            >
              {busy ? "ממתין למכשיר..." : "המשך ל-Touch ID"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="px-3 text-sm text-appNavy/60">
              ביטול
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-4 rounded-full border border-lineDark px-4 py-2 text-sm text-appNavy hover:bg-appNavy/5"
        >
          הוספת passkey
        </button>
      )}
      {error && <p className="mt-3 text-xs text-error">{error}</p>}
    </div>
  );
}

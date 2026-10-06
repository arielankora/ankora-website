"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, Check, KeyRound, Lock } from "lucide-react";

// The one place in the browser where a client's login appears
// (claude/credentials-vault-spec-2026-10-06.md, "חוויית המסך").
//
// 1. "הצגת פרטי גישה" asks the reveal route.
// 2. If there is no open identity window, the route says so and this
//    component asks for the person's own Ankora password, then asks the
//    reveal route again.
// 3. The values stay on screen for SHOW_MS, then disappear from state.
//    Anything copied is overwritten in the clipboard after the same time,
//    where the browser allows it.
//
// The values live only in this component's state. They are never put in
// the URL, never in a cookie, never in storage, and the route answers
// with no-store.

const SHOW_MS = 30_000;

type Secret = { username: string | null; password: string | null; notes: string | null };
type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "step-up"; error?: string }
  | { kind: "shown"; secret: Secret; until: number }
  | { kind: "error"; message: string };

async function postJson(url: string, body: unknown) {
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
    // An error page instead of JSON; treated as a refusal below.
  }
  return { status: res.status, data };
}

export function RevealCredential({ credentialId, taskId }: { credentialId: string; taskId?: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const copied = useRef(false);

  async function reveal() {
    setPhase({ kind: "loading" });
    const { status, data } = await postJson(`/api/credentials/${encodeURIComponent(credentialId)}/reveal`, {
      taskId: taskId ?? null,
    });
    if (status === 200 && data) {
      setPhase({ kind: "shown", secret: data as Secret, until: Date.now() + SHOW_MS });
      return;
    }
    if (status === 403 && data?.error === "step_up_required") return setPhase({ kind: "step-up" });
    if (status === 404) return setPhase({ kind: "error", message: "הגישה לא נמצאה." });
    if (status === 401) return setPhase({ kind: "error", message: "פג תוקף ההתחברות. יש להתחבר מחדש." });
    setPhase({ kind: "error", message: data?.message ?? "לא ניתן להציג את פרטי הגישה כרגע." });
  }

  async function stepUp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    setPhase({ kind: "loading" });
    const { status, data } = await postJson("/api/step-up", { password });
    form.reset();
    if (status === 200) return reveal();
    if (status === 401 && data?.error === "wrong_password") return setPhase({ kind: "step-up", error: data.message });
    setPhase({ kind: "error", message: data?.message ?? "האימות נכשל." });
  }

  // Countdown, then forget.
  useEffect(() => {
    if (phase.kind !== "shown") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const end = setTimeout(() => {
      setPhase({ kind: "idle" });
      if (copied.current) {
        copied.current = false;
        navigator.clipboard?.writeText("").catch(() => {});
      }
    }, Math.max(0, phase.until - Date.now()));
    return () => {
      clearInterval(tick);
      clearTimeout(end);
    };
  }, [phase]);

  if (phase.kind === "idle" || phase.kind === "error") {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={reveal}
          className="inline-flex items-center gap-1.5 rounded-full border border-lineDark px-3 py-1.5 text-xs font-medium text-appNavy hover:bg-appNavy/5"
        >
          <KeyRound size={14} strokeWidth={1.75} />
          הצגת פרטי גישה
        </button>
        {phase.kind === "error" && <p className="text-xs text-error">{phase.message}</p>}
      </div>
    );
  }

  if (phase.kind === "loading") {
    return <p className="text-xs text-appNavy/60">רגע...</p>;
  }

  if (phase.kind === "step-up") {
    return (
      <form onSubmit={stepUp} className="w-full max-w-sm rounded-xl border border-lineDark bg-cream-dim p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-appNavy">
          <Lock size={13} strokeWidth={1.75} />
          אימות זהות
        </p>
        <p className="mt-1 text-xs text-appNavy/60">הקלידו את הסיסמה שלכם לאנקורה. האימות תקף ל-5 דקות.</p>
        <div className="mt-2 flex gap-2">
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-label="הסיסמה שלך לאנקורה"
            className="min-w-0 flex-1 rounded-lg border border-lineDark bg-white px-3 py-1.5 text-sm text-appNavy outline-none focus:border-gold"
          />
          <button type="submit" className="rounded-full bg-appNavy px-4 py-1.5 text-xs font-medium text-cream">
            אימות
          </button>
          <button type="button" onClick={() => setPhase({ kind: "idle" })} className="px-2 text-xs text-appNavy/60">
            ביטול
          </button>
        </div>
        {phase.error && <p className="mt-2 text-xs text-error">{phase.error}</p>}
      </form>
    );
  }

  const seconds = Math.max(0, Math.ceil((phase.until - now) / 1000));
  const { secret } = phase;
  return (
    <div className="w-full max-w-md rounded-xl border border-lineDark bg-cream-dim p-3">
      <dl className="flex flex-col gap-2">
        <SecretLine label="שם משתמש" value={secret.username} onCopy={() => (copied.current = true)} />
        <SecretLine label="סיסמה" value={secret.password} onCopy={() => (copied.current = true)} />
        {secret.notes && (
          <div>
            <dt className="text-[11px] text-appNavy/60">הערות</dt>
            <dd className="whitespace-pre-wrap text-sm text-appNavy">{secret.notes}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex items-center justify-between text-[11px] text-appNavy/50">
        <span>הצפייה נרשמה.</span>
        <span>
          נעלם בעוד {seconds} שניות ·{" "}
          <button type="button" onClick={() => setPhase({ kind: "idle" })} className="underline">
            להסתיר עכשיו
          </button>
        </span>
      </div>
    </div>
  );
}

function SecretLine({ label, value, onCopy }: { label: string; value: string | null; onCopy: () => void }) {
  const [done, setDone] = useState(false);
  if (value === null) {
    return (
      <div>
        <dt className="text-[11px] text-appNavy/60">{label}</dt>
        <dd className="text-sm text-appNavy/40">לא נשמר</dd>
      </div>
    );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      onCopy();
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // The value is selectable; a refused clipboard is not an error.
    }
  }
  return (
    <div>
      <dt className="text-[11px] text-appNavy/60">{label}</dt>
      <dd className="flex items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 select-all break-all text-start text-sm text-appNavy">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`העתקת ${label}`}
          className="shrink-0 rounded-md p-1.5 text-appNavy/60 hover:bg-appNavy/5 hover:text-appNavy"
        >
          {done ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </dd>
    </div>
  );
}

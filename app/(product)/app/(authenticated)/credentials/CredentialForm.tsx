"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { createCredentialAction, updateCredentialAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";

// Add and edit, one form. Editing never shows the stored username,
// password or notes: the fields start empty, and empty means "unchanged".
// Seeing a value is a reveal, and a reveal goes through its own route,
// its own identity check and its own audit row. A form that pre-filled
// them would be a second, unaudited reveal.
//
// autoComplete="new-password" and "off" keep the employee's browser from
// offering to save a CLIENT's password into the employee's personal
// password manager, which is where it would otherwise end up.

const INPUT =
  "mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold";
const LABEL = "block text-xs font-medium text-appNavy/60";

type Existing = {
  id: string;
  systemName: string;
  url: string | null;
  hasUsername: boolean;
  hasPassword: boolean;
  hasNotes: boolean;
};

export function CredentialForm({
  clients,
  clientId,
  existing,
}: {
  clients: { id: string; name: string }[];
  clientId: string;
  existing?: Existing;
}) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(existing ? updateCredentialAction : createCredentialAction, close);
  const [showPassword, setShowPassword] = useState(false);
  const kept = "נשמר. להשאיר ריק ללא שינוי";

  return (
    <form onSubmit={onSubmit} autoComplete="off" className="flex flex-col gap-4">
      {existing ? (
        <input type="hidden" name="id" value={existing.id} />
      ) : (
        <div>
          <label className={LABEL} htmlFor="cred-client">לקוח *</label>
          <select id="cred-client" name="clientId" defaultValue={clientId} required className={INPUT}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={LABEL} htmlFor="cred-name">שם המערכת *</label>
        <input id="cred-name" name="systemName" required maxLength={120} defaultValue={existing?.systemName} className={INPUT} />
      </div>
      <div>
        <label className={LABEL} htmlFor="cred-url">קישור</label>
        <input
          id="cred-url"
          name="url"
          dir="ltr"
          inputMode="url"
          placeholder="https://"
          maxLength={2048}
          defaultValue={existing?.url ?? ""}
          className={INPUT}
        />
      </div>

      <div className="rounded-xl border border-lineDark bg-cream-dim p-4">
        <p className="text-xs text-appNavy/60">שלושת השדות האלה נשמרים מוצפנים, ומוצגים רק אחרי אימות זהות.</p>
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <label className={LABEL} htmlFor="cred-user">שם משתמש</label>
            <input
              id="cred-user"
              name="username"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={256}
              placeholder={existing?.hasUsername ? kept : undefined}
              className={INPUT}
            />
            {existing?.hasUsername && <ClearBox name="clear_username" label="להסיר את שם המשתמש השמור" />}
          </div>
          <div>
            <label className={LABEL} htmlFor="cred-pass">סיסמה</label>
            {/* Physical left, not logical end: the field itself is LTR,
                so its text starts on the left and the toggle must not sit
                on top of it. */}
            <div className="relative">
              <input
                id="cred-pass"
                name="password"
                dir="ltr"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                spellCheck={false}
                maxLength={1024}
                placeholder={existing?.hasPassword ? kept : undefined}
                className={`${INPUT} pl-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "הסתרת הסיסמה שמוקלדת" : "הצגת הסיסמה שמוקלדת"}
                className="absolute inset-y-0 left-2 mt-1.5 flex items-center text-appNavy/50 hover:text-appNavy"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {existing?.hasPassword && <ClearBox name="clear_password" label="להסיר את הסיסמה השמורה" />}
          </div>
          <div>
            <label className={LABEL} htmlFor="cred-notes">הערות</label>
            <textarea
              id="cred-notes"
              name="notes"
              rows={3}
              maxLength={4000}
              placeholder={existing?.hasNotes ? kept : "שאלות אבטחה, קודי גיבוי, מי מקבל את קוד האימות"}
              className={INPUT}
            />
            {existing?.hasNotes && <ClearBox name="clear_notes" label="להסיר את ההערות השמורות" />}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
      >
        {pending ? "נשמר..." : existing ? "שמירת השינויים" : "הוספת הגישה"}
      </button>
    </form>
  );
}

function ClearBox({ name, label }: { name: string; label: string }) {
  return (
    <label className="mt-2 flex items-center gap-2 text-xs text-appNavy/60">
      <input type="checkbox" name={name} className="accent-appNavy" />
      {label}
    </label>
  );
}

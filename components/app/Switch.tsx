"use client";

// App redesign (handoff README, screen 13 "התראות" + Responsive section):
// "חוקי התראה עם מתגי הפעלה 42×24px" - the one toggle-switch visual the
// handoff specifies a pixel size for. Shared here since Report Schedules
// (screen 12) and Profile's notification preferences (screen 18) use the
// exact same on/off affordance - a single small control, not a form field.
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-[42px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-gold-gradient" : "bg-appNavy/15"
      }`}
    >
      <span
        className={`absolute top-0.5 block h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? "end-0.5" : "start-0.5"
        }`}
      />
    </button>
  );
}

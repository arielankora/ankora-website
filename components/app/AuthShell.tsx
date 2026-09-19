import type { ReactNode } from "react";

// App redesign (handoff README, screen 17 "כניסה ושחזור סיסמה"): the
// prototype's two-column auth layout - a dark `ink` column with the logo,
// a positioning line and a radial gold glow (same treatment as the Timer
// hero card, components/app/.../TimerWidget.tsx), and a light `paper`
// column holding the form, capped at 380px. Shared by login/,
// forgot-password/ and reset-password/ so the three screens read as one
// flow rather than three differently-styled pages. `auto-fit/minmax(320px,1fr)`
// per the handoff's Responsive rule (no fixed-width columns) - below
// ~640px the two columns stack instead of squeezing.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-[repeat(auto-fit,minmax(320px,1fr))]">
      <div className="relative flex flex-col justify-between overflow-hidden bg-ink px-8 py-12 text-cream sm:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_55%_at_65%_30%,rgba(176,141,87,0.24)_0%,rgba(176,141,87,0)_70%)]" />
        <span className="relative font-assistant text-sm font-semibold tracking-[0.2em] text-gold-light">ANKORA</span>
        <div className="relative max-w-[380px]">
          <p className="text-2xl font-normal leading-relaxed">אינטליגנציה תפעולית שמחזירה זמן.</p>
          <p className="mt-3.5 text-sm text-cream/60">
            מערכת התפעול הפנימית של Ankora. הגישה מוגבלת למשתמשים מורשים.
          </p>
        </div>
        <span className="relative text-[11.5px] text-cream/40">Tel Aviv, Israel</span>
      </div>

      <div className="flex flex-col items-center justify-center bg-paper px-8 py-12 sm:px-10">
        <div className="w-full max-w-[380px]">{children}</div>
      </div>
    </div>
  );
}

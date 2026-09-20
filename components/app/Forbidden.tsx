import { ShieldAlert } from "lucide-react";

// App redesign (handoff README, "19. מצבי מסך"): "403 ('אין לך הרשאה' +
// התפקיד הנוכחי)". `roleLabel` is optional and kept backward compatible -
// the ~25 existing call sites across every gated screen render <Forbidden
// /> with no props today; threading the caller's role label through all of
// them is left as a small follow-up rather than done here, since it
// touches every one of those files for a cosmetic detail. When a caller
// does pass it, the current role is shown per spec.
export function Forbidden({ roleLabel }: { roleLabel?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-lineDark bg-white px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-error-soft">
        <ShieldAlert size={20} strokeWidth={1.75} className="text-error" />
      </span>
      <p className="text-[15px] font-medium text-appNavy">אין לך הרשאה לצפות בעמוד זה</p>
      {roleLabel && <p className="text-sm text-appNavy/60">התפקיד הנוכחי שלך: {roleLabel}</p>}
    </div>
  );
}

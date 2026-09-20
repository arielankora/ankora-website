"use client";
import { useState } from "react";
import { ServerCrash, Copy, Check } from "lucide-react";

// App redesign (handoff README, "19. מצבי מסך"): "500 (עם קוד שגיאה
// להעתקה)". `errorCode` is meant to be something a support conversation can
// reference back to server logs - callers pass whatever they already have
// (a Next.js error digest, a request id, ...); this component only renders
// and copies it, it never generates one itself.
export function ServerError({
  errorCode,
  onRetry,
}: {
  errorCode?: string;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!errorCode) return;
    try {
      await navigator.clipboard.writeText(errorCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) - the code is
      // still visible on screen to copy by hand, so this fails silently.
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-lineDark bg-white px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-error-soft">
        <ServerCrash size={20} strokeWidth={1.75} className="text-error" />
      </span>
      <p className="text-[15px] font-medium text-appNavy">משהו השתבש</p>
      <p className="max-w-sm text-sm text-appNavy/60">אירעה שגיאה בטעינת המסך. אפשר לנסות שוב, או לפנות לתמיכה עם הקוד הבא.</p>
      {errorCode && (
        <button
          type="button"
          onClick={handleCopy}
          className="mt-1 flex items-center gap-1.5 rounded-full border border-lineDark bg-cream px-3 py-1.5 font-jbmono text-xs text-appNavy/70 hover:border-gold"
        >
          <span dir="ltr">{errorCode}</span>
          {copied ? <Check size={13} strokeWidth={2} className="text-success" /> : <Copy size={13} strokeWidth={1.75} />}
        </button>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy"
        >
          ניסיון חוזר
        </button>
      )}
    </div>
  );
}

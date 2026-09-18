"use client";
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Tracks browser connectivity. Note this only reflects `navigator.onLine`
 * (the browser's own network-interface signal) - it does not by itself
 * make the Timer or any Server Action work offline. Real offline
 * persistence (a local queue of not-yet-synced time entries, replayed once
 * back online) is a separate, considerably larger piece of work than this
 * presentational banner and is not implemented by this component - see the
 * `pendingSyncCount` prop doc on OfflineBanner below.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

// App redesign (handoff README, "19. מצבי מסך"): "ללא רשת (הטיימר ממשיך
// מקומית + מונה ממתינים לסנכרון)". This banner renders whenever the
// browser reports itself offline; `pendingSyncCount` is intentionally
// optional and only rendered when a caller actually passes a real number -
// this component does not invent or track a queue itself. Wiring an actual
// local offline queue for the Timer (so time entries keep accruing and
// sync once reconnected) is flagged as follow-up work, not silently
// assumed done by this banner's existence.
export function OfflineBanner({ pendingSyncCount }: { pendingSyncCount?: number }) {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-navy"
      role="status"
    >
      <WifiOff size={16} strokeWidth={1.75} className="shrink-0 text-warning" />
      <p>
        אין חיבור לרשת. הטיימר ממשיך לרוץ מקומית.
        {typeof pendingSyncCount === "number" && pendingSyncCount > 0 && (
          <span className="font-jbmono"> {pendingSyncCount} ממתינים לסנכרון.</span>
        )}
      </p>
    </div>
  );
}

// App redesign (handoff README, "19. מצבי מסך"): "מצב טעינה (שלד תוכן עם
// ank-sweep, לא ספינר)". SkeletonBlock is the one primitive - a shimmering
// bar/card shape - every loading.tsx and any screen with its own inline
// loading state should compose from, so the shimmer animation only lives
// in one place.
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-sweep rounded-lg bg-sweep-gradient bg-[length:200%_100%] ${className}`}
      aria-hidden="true"
    />
  );
}

/** Generic full-screen skeleton: title bar + KPI-card row + one large panel. */
export function SkeletonScreen() {
  return (
    <div className="space-y-6" role="status" aria-label="טוען…">
      <SkeletonBlock className="h-6 w-40" />
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <SkeletonBlock className="h-64 rounded-2xl" />
    </div>
  );
}

/** Table-shaped skeleton for list screens (Clients, Time Entries, Audit Log, ...). */
export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="טוען…">
      <SkeletonBlock className="h-6 w-32" />
      <div className="overflow-hidden rounded-2xl border border-lineDark bg-white">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-lineDark/60 px-5 py-4 last:border-b-0">
            <SkeletonBlock className="h-4 flex-1" />
            <SkeletonBlock className="h-4 w-20" />
            <SkeletonBlock className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

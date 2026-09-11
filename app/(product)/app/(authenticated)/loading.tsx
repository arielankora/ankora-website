// Phase 7 (spec 20: "Loading skeletons במסכים מרכזיים"). A single generic
// skeleton for the whole /app/** tree rather than a bespoke one per
// screen - Next.js's loading.tsx convention shows this automatically
// during server-side data fetches on navigation, replacing what used to
// be a blank page mid-navigation with a shape that at least previews the
// coming layout (header space + a few card-shaped placeholders).
export default function AppLoading() {
  return (
    <div className="animate-pulse space-y-4" role="status" aria-label="טוען...">
      <div className="h-6 w-40 rounded bg-lineDark/60" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-lineDark bg-white" />
        ))}
      </div>
      <div className="h-64 rounded-2xl border border-lineDark bg-white" />
    </div>
  );
}

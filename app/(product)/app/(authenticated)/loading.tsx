// Phase 7 (spec 20: "Loading skeletons במסכים מרכזיים"). A single generic
// skeleton for the whole /app/** tree rather than a bespoke one per
// screen - Next.js's loading.tsx convention shows this automatically
// during server-side data fetches on navigation, replacing what used to
// be a blank page mid-navigation with a shape that at least previews the
// coming layout (header space + a few card-shaped placeholders).
//
// App redesign (handoff README, "19. מצבי מסך"): "מצב טעינה (שלד תוכן עם
// ank-sweep, לא ספינר)" - swapped the plain animate-pulse dimming for the
// shared SkeletonScreen (SkeletonBlock's sweep shimmer), same shape as
// before.
import { SkeletonScreen } from "@/components/app/states/Skeleton";

export default function AppLoading() {
  return <SkeletonScreen />;
}

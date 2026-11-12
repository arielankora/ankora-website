import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalTimeline } from "@/lib/app-domain/client-portal";
import { Forbidden } from "@/components/app/Forbidden";
import { PromiseList } from "../PromiseList";

export const metadata = { robots: { index: false, follow: false } };

// Portal phase 1, the activity stream.
//
// This replaces the row-per-time-entry table as the client's answer to
// "what happened". The old table was true and unreadable: it listed
// billable minutes per entry, which asks a client to reconstruct their
// own story out of our timesheet. The same events, told as promises and
// ordered by what moved most recently, are the story.
//
// The per-day hours breakdown that used to live on the "פעילות שבועית"
// tab is still there, one click from the שעות screen. Nothing was
// removed - what changed is which of the two a client meets first.
export default async function PortalActivityPage() {
  const user = await requireUser();

  let timeline;
  try {
    timeline = await getPortalTimeline(user);
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden />;
    throw err;
  }

  const t = await getTranslations("portal.activity");

  return (
    <div className="space-y-4">

      <PromiseList
        title={t("title")}
        promises={timeline.promises}
        emptyText={t("empty")}
        action={
          <Link href="/app/portal/hours" className="text-xs text-app-text-accent hover:underline">
            {t("hoursLink")}
          </Link>
        }
      />
    </div>
  );
}

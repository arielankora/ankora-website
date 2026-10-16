import type { Metadata } from "next";
import { headers } from "next/headers";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { viewUploadLink } from "@/lib/app-domain/agreements";
import { UploadForm } from "./UploadForm";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // The token is in the path; no referrer leaves with it.
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

// The personal page for uploading a signed agreement PDF (16.10.2026),
// opened from the email that carried the blank form. Outside /app for the
// same reason as /agreements/sign/[token]: the person may have no session,
// and the middleware only gates /app. Same headers via next.config.mjs's
// /agreements/:path* rule, and the same view budget.
const VIEW_LIMIT = 30;
const VIEW_WINDOW_MS = 15 * 60 * 1000;

function Unavailable() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <span className="font-assistant text-sm font-semibold tracking-[0.2em] text-gold-dim">ANKORA</span>
      <h1 className="mt-8 text-xl font-medium text-appNavy">הקישור אינו זמין</h1>
      <p className="mt-3 text-sm leading-7 text-appNavy/70">
        אי אפשר להעלות קובץ מהקישור הזה. אם עדיין צריך לשלוח את הטופס החתום, אפשר לפנות ל-ops@ankora.co.il ולבקש קישור חדש.
      </p>
    </main>
  );
}

export default async function AgreementUploadPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  const ip = clientIpFrom(await headers());
  if (!(await checkRateLimit(`agreement-upload-view:${ip}`, VIEW_LIMIT, VIEW_WINDOW_MS)).allowed) {
    return <Unavailable />;
  }

  // Missing, used and expired look the same on purpose.
  const view = await viewUploadLink(token);
  if (!view) return <Unavailable />;

  return (
    <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <span className="font-assistant text-sm font-semibold tracking-[0.2em] text-gold-dim">ANKORA</span>

      <h1 className="mt-8 text-2xl font-medium text-appNavy">העלאת {view.title} חתום</h1>
      <p className="mt-3 text-sm leading-7 text-appNavy/70">
        {view.userName}, כאן מעלים את הטופס ששלחנו במייל, אחרי קריאה וחתימה. אפשר חתימה דיגיטלית, או הדפסה, חתימה וסריקה.
      </p>
      <p className="mt-2 text-xs text-appNavy/50" dir="auto">
        גרסה {view.version} · <span dir="ltr">{view.code}</span>
      </p>

      <div className="mt-8">
        <UploadForm token={token} />
      </div>

      <p className="mt-4 text-xs text-appNavy/50">הקישור אישי ומיועד לשימוש אחד. הקובץ נשמר אצל אנקורה בלבד.</p>
    </main>
  );
}

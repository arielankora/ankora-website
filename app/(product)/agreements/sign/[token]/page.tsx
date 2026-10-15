import type { Metadata } from "next";
import { headers } from "next/headers";
import { agreementBody, unescapeMarkdown } from "@/lib/agreements";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { viewSignLink } from "@/lib/app-domain/agreements";
import { AgreementText } from "@/components/app/agreements/AgreementText";
import { AgreementSignForm } from "@/components/app/agreements/AgreementSignForm";
import { signWithLinkAction } from "./actions";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // The token is in the path. No referrer, so it never leaves in a
  // header to whatever this page might link to.
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

// The one-time page for signing an agreement without a session, opened
// from an email by someone whose work account is usually already
// suspended. That is why it lives outside /app: middleware gates every
// /app path on a session, and this person has none.
//
// Opening it is rate limited as well as submitting it. A token is 256
// random bits and cannot be guessed, so this is about load rather than
// secrecy: 30 views per IP per 15 minutes.
const VIEW_LIMIT = 30;
const VIEW_WINDOW_MS = 15 * 60 * 1000;

function Unavailable() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <span className="font-assistant text-sm font-semibold tracking-[0.2em] text-gold-dim">ANKORA</span>
      <h1 className="mt-8 text-xl font-medium text-appNavy">הקישור אינו זמין</h1>
      <p className="mt-3 text-sm leading-7 text-appNavy/70">
        אי אפשר לפתוח את המסמך מהקישור הזה. אם עדיין צריך לאשר אותו, אפשר לפנות ל-ops@ankora.co.il ולבקש קישור חדש.
      </p>
    </main>
  );
}

export default async function AgreementLinkPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  const ip = clientIpFrom(await headers());
  if (!(await checkRateLimit(`agreement-link-view:${ip}`, VIEW_LIMIT, VIEW_WINDOW_MS)).allowed) {
    return <Unavailable />;
  }

  // Missing, used and expired look the same on purpose.
  const view = await viewSignLink(token);
  if (!view) return <Unavailable />;

  const body = unescapeMarkdown(agreementBody(view.text));

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <span className="font-assistant text-sm font-semibold tracking-[0.2em] text-gold-dim">ANKORA</span>

      <h1 className="mt-8 text-2xl font-medium text-appNavy">{view.agreement.title}</h1>
      <p className="mt-2 text-sm text-appNavy/60">
        {view.userName}, יש לקרוא את ההצהרה ולאשר אותה. גרסה {view.agreement.version}.
      </p>

      <div className="mt-8 rounded-2xl border border-lineDark bg-white p-6">
        <AgreementText body={body} />
      </div>

      <div className="mt-6">
        <AgreementSignForm
          action={signWithLinkAction}
          version={view.agreement.version}
          token={token}
          consentLabel="קראתי את ההצהרה, היא נכונה, ואני מאשר/ת אותה"
          doneMessage="ההצהרה נחתמה ונשמרה. תודה. אפשר לסגור את הדף."
        />
      </div>

      <p className="mt-4 text-xs text-appNavy/50">
        עם האישור נשמרים השם שהוקלד, התאריך והשעה, כתובת ה-IP, הדפדפן והגרסה, ועותק חתום נשמר אצל אנקורה.
      </p>
    </main>
  );
}

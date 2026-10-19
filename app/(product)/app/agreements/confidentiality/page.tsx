import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import {
  agreementBody,
  confidentialitySignatures,
  currentAgreement,
  loadAgreementText,
  mustSignConfidentiality,
  unescapeMarkdown,
} from "@/lib/agreements";
import { AgreementText } from "@/components/app/agreements/AgreementText";
import { AgreementSignForm } from "@/components/app/agreements/AgreementSignForm";
import { LogoutButton } from "@/components/app/LogoutButton";
import { signConfidentialityAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Deliberately outside the (authenticated) route group: that layout is
// what redirects here, so living under it would loop. It still requires a
// session, and it offers sign-out, because "not now" has to be possible
// without signing.
export default async function ConfidentialityPage() {
  const user = await requireUser();

  // Nothing to sign: a client, or someone who already has. Back to work.
  if (!mustSignConfidentiality(user.role, await confidentialitySignatures(user.id))) redirect("/app");

  const agreement = currentAgreement("CONFIDENTIALITY");
  const body = unescapeMarkdown(agreementBody(loadAgreementText(agreement)));

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <span className="font-assistant text-sm font-semibold tracking-[0.2em] text-app-text-accent">ANKORA</span>
        <LogoutButton />
      </div>

      <h1 className="mt-8 text-2xl font-medium text-app-text-primary">{agreement.title}</h1>
      <p className="mt-2 text-sm text-app-text-secondary">
        לפני הכניסה למערכת, {user.name}, יש לקרוא ולאשר את ההתחייבות. גרסה {agreement.version}.
      </p>

      <div className="mt-8 rounded-2xl border border-app-border bg-white p-6">
        <AgreementText body={body} />
      </div>

      <div className="mt-6">
        <AgreementSignForm
          action={signConfidentialityAction}
          version={agreement.version}
          consentLabel="קראתי את ההתחייבות ואני מסכים/ה לה"
        />
      </div>

      <p className="mt-4 text-xs text-app-text-tertiary">
        עם האישור נשמרים השם שהוקלד, התאריך והשעה, כתובת ה-IP, הדפדפן והגרסה, ועותק חתום נשמר בתיק איש הצוות.
      </p>
    </main>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/app/AuthShell";
import { RequestLinkForm } from "./RequestLinkForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function RequestLoginLinkPage() {
  const t = await getTranslations("auth.link");
  return (
    <AuthShell>
      <p className="text-[22px] font-medium text-app-text-primary">{t("requestTitle")}</p>
      <p className="mb-6 mt-2 text-[13.5px] text-app-text-secondary">{t("requestSubtitle")}</p>
      <RequestLinkForm />
    </AuthShell>
  );
}

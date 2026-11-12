import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/app/AuthShell";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgot");
  return (
    <AuthShell>
      <p className="text-[22px] font-medium text-app-text-primary">{t("title")}</p>
      <p className="mb-6 mt-2 text-[13.5px] text-app-text-secondary">{t("subtitle")}</p>
      <ForgotPasswordForm />
    </AuthShell>
  );
}

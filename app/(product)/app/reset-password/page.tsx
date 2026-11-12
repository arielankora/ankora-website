import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/app/AuthShell";
import { PASSWORD_MIN_LENGTH } from "@/lib/app-auth/password";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ResetPasswordPage(
  props: {
    searchParams: Promise<{ token?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const token = searchParams?.token || "";
  const t = await getTranslations("auth.reset");

  return (
    <AuthShell>
      <p className="text-[22px] font-medium text-app-text-primary">{t("title")}</p>
      <p className="mb-6 mt-2 text-[13.5px] text-app-text-secondary">{t("subtitle", { min: PASSWORD_MIN_LENGTH })}</p>

      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-sm text-app-error">
          {t("errors.link_invalid")}{" "}
          <Link href="/app/forgot-password" className="underline">
            {t("requestNew")}
          </Link>
        </p>
      )}

      <p className="mt-6 text-center text-xs text-app-text-tertiary">
        <Link href="/app/login" className="hover:text-app-text-accent">
          {t("backToSignIn")}
        </Link>
      </p>
    </AuthShell>
  );
}

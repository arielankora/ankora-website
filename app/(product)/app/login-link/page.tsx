import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/app/AuthShell";
import { LoginLinkConsumer } from "./LoginLinkConsumer";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function LoginLinkPage(props: { searchParams: Promise<{ token?: string }> }) {
  const searchParams = await props.searchParams;
  const token = String(searchParams.token || "");
  const t = await getTranslations("auth.link");

  return (
    <AuthShell>
      <p className="text-[22px] font-medium text-app-text-primary">{t("title")}</p>
      <p className="mb-6 mt-2 text-[13.5px] text-app-text-secondary">{t("subtitle")}</p>

      {token ? (
        <LoginLinkConsumer token={token} />
      ) : (
        <>
          <p className="rounded-[10px] border border-app-error/30 bg-app-error-soft px-3 py-2.5 text-xs text-app-error">
            {t("invalid")}
          </p>
          <Link
            href="/app/login-link/request"
            className="mt-5 flex min-h-[50px] w-full items-center justify-center rounded-full bg-app-accent text-[15px] font-medium text-app-text-primary"
          >
            {t("sendNew")}
          </Link>
        </>
      )}

      <p className="mt-8 text-center text-[11px] text-app-text-tertiary">
        <Link href="/app/login" className="hover:text-app-text-secondary">
          {t("withPassword")}
        </Link>
      </p>
    </AuthShell>
  );
}

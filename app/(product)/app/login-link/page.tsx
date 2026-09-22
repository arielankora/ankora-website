import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/app/AuthShell";
import { LoginLinkConsumer } from "./LoginLinkConsumer";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function LoginLinkPage(props: { searchParams: Promise<{ token?: string }> }) {
  const searchParams = await props.searchParams;
  const token = String(searchParams.token || "");

  return (
    <AuthShell>
      <p className="text-[22px] font-medium text-appNavy">כניסה לפורטל</p>
      <p className="mb-6 mt-2 text-[13.5px] text-appNavy/60">קישור חד פעמי, ללא סיסמה.</p>

      {token ? (
        <LoginLinkConsumer token={token} />
      ) : (
        <>
          <p className="rounded-[10px] border border-error/30 bg-error-soft px-3 py-2.5 text-xs text-error">
            הקישור אינו תקין או שפג תוקפו.
          </p>
          <Link
            href="/app/login-link/request"
            className="mt-5 flex min-h-[50px] w-full items-center justify-center rounded-full bg-gold-gradient text-[15px] font-medium text-navy"
          >
            שליחת קישור חדש
          </Link>
        </>
      )}

      <p className="mt-8 text-center text-[11px] text-appNavy/40">
        <Link href="/app/login" className="hover:text-appNavy/60">
          כניסה עם סיסמה
        </Link>
      </p>
    </AuthShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/app/AuthShell";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams?.token || "";

  return (
    <AuthShell>
      <p className="text-[22px] font-medium text-navy">בחירת סיסמה חדשה</p>
      <p className="mb-6 mt-2 text-[13.5px] text-navy/60">לפחות 10 תווים.</p>

      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-sm text-error">
          הקישור אינו תקין או שפג תוקפו.{" "}
          <Link href="/app/forgot-password" className="underline">
            בקשה חדשה לאיפוס סיסמה
          </Link>
        </p>
      )}

      <p className="mt-6 text-center text-xs text-navy/50">
        <Link href="/app/login" className="hover:text-gold-dim">
          חזרה להתחברות
        </Link>
      </p>
    </AuthShell>
  );
}

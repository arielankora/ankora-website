import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams?.token || "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-lineDark bg-white p-8 shadow-sm">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-dim">Ankora</span>
          <h1 className="mt-2 text-xl font-medium text-navy">קביעת סיסמה חדשה</h1>
        </div>

        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p className="mt-8 text-sm text-red-600">
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
      </div>
    </div>
  );
}

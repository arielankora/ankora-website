import type { Metadata } from "next";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-lineDark bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-medium text-navy">שכחתי סיסמה</h1>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}

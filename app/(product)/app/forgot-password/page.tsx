import type { Metadata } from "next";
import { AuthShell } from "@/components/app/AuthShell";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <p className="text-[22px] font-medium text-navy">שחזור סיסמה</p>
      <p className="mb-6 mt-2 text-[13.5px] text-navy/60">נשלח קישור לאיפוס לכתובת המייל. הקישור תקף לשעה אחת.</p>
      <ForgotPasswordForm />
    </AuthShell>
  );
}

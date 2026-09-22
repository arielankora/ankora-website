import type { Metadata } from "next";
import { AuthShell } from "@/components/app/AuthShell";
import { RequestLinkForm } from "./RequestLinkForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function RequestLoginLinkPage() {
  return (
    <AuthShell>
      <p className="text-[22px] font-medium text-appNavy">כניסה בקישור</p>
      <p className="mb-6 mt-2 text-[13.5px] text-appNavy/60">
        נשלח קישור כניסה חד פעמי לכתובת המייל. אין צורך בסיסמה.
      </p>
      <RequestLinkForm />
    </AuthShell>
  );
}

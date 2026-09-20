import type { Metadata } from "next";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLoginPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  return (
    <div className="bg-cream px-6 py-32">
      <div className="mx-auto max-w-content">
        <h1 className="text-center text-2xl font-medium text-appNavy">Ankora blog admin</h1>
        <AdminLoginForm redirectTo={`/${locale}/admin`} />
      </div>
    </div>
  );
}

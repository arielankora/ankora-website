import type { Metadata } from "next";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminLoginPage({ params }: { params: { locale: string } }) {
  const locale = params.locale === "en" ? "en" : "he";
  return (
    <div className="bg-paper px-6 py-32">
      <div className="mx-auto max-w-content">
        <h1 className="text-center text-2xl font-medium text-navy">Ankora blog admin</h1>
        <AdminLoginForm redirectTo={`/${locale}/admin`} />
      </div>
    </div>
  );
}

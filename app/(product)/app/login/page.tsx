import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-lineDark bg-white p-8 shadow-sm">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-dim">Ankora</span>
          <h1 className="mt-2 text-xl font-medium text-navy">ניהול שעות ובנקי שעות</h1>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}

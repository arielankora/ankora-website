"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminLoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Login failed.");
        setLoading(false);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-10 max-w-sm rounded-2xl border border-lineDark bg-white/60 p-8">
      <label className="block text-sm font-medium text-navy/70">Admin password</label>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-6 w-full rounded-full bg-gold-gradient px-6 py-3 text-sm font-medium text-ink transition-opacity disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

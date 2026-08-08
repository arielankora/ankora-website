"use client";

import { useState } from "react";
import type { Dictionary } from "@/content";

type Status = "idle" | "loading" | "success" | "error";

export function ContactForm({ p }: { p: Dictionary["pages"]["contact"] }) {
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    const form = e.currentTarget;
    const data = new FormData(form);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          company: data.get("company"),
          message: data.get("message"),
        }),
      });

      if (!res.ok) throw new Error("Request failed");

      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
    }
  }

  const fieldClass =
    "w-full rounded-xl border border-line bg-transparent px-4 py-3 text-paper outline-none transition-colors focus:border-lineGold";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="mb-2 block text-sm text-paper/60">{p.nameLabel}</label>
        <input name="name" type="text" required className={fieldClass} />
      </div>
      <div>
        <label className="mb-2 block text-sm text-paper/60">{p.emailLabel}</label>
        <input name="email" type="email" required className={fieldClass} />
      </div>
      <div>
        <label className="mb-2 block text-sm text-paper/60">{p.companyLabel}</label>
        <input name="company" type="text" className={fieldClass} />
      </div>
      <div>
        <label className="mb-2 block text-sm text-paper/60">{p.messageLabel}</label>
        <textarea name="message" rows={4} className={fieldClass} />
      </div>

      <button
        type="submit"
        disabled={status === "loading"}
        className="rounded-full bg-gold-gradient px-7 py-3.5 text-[15px] font-medium text-ink transition-transform hover:scale-[1.02] disabled:opacity-60 disabled:hover:scale-100"
      >
        {status === "loading" ? "..." : p.submit}
      </button>

      {status === "success" && (
        <p className="text-sm text-gold-light">{p.successMessage}</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-400">{p.errorMessage}</p>
      )}
    </form>
  );
}

"use client";

import { useState } from "react";
import type { Dictionary, Locale } from "@/content";
import { GlassPanel } from "@/components/ui/GlassPanel";

type Status = "idle" | "loading" | "success" | "error";

// /he redesign: glass form panel per design_handoff_ankora_redesign/README.md,
// "Contact" -- fields rgba(11,27,51,0.5) with a 1px hairline border, gold border +
// rgba(176,141,87,0.06) fill on focus, sharp corners. Same submit logic and real
// /api/contact endpoint as /en -- only the visual layer changes. Email stays the one
// LTR island inside the RTL form per spec.
function HeContactForm({ p }: { p: Dictionary["pages"]["contact"] }) {
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
    "w-full border border-[rgba(243,234,219,0.18)] bg-[rgba(11,27,51,0.5)] px-4 py-3 text-paper outline-none transition-colors focus:border-gold focus:bg-[rgba(176,141,87,0.06)]";

  return (
    <GlassPanel elevated className="p-[clamp(22px,3vw,40px)]">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-2 block text-sm text-[#A9B8C9]">{p.nameLabel}</label>
          <input name="name" type="text" required className={fieldClass} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-[#A9B8C9]">{p.emailLabel}</label>
          <input name="email" type="email" required dir="ltr" className={`${fieldClass} text-end`} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-[#A9B8C9]">{p.companyLabel}</label>
          <input name="company" type="text" className={fieldClass} />
        </div>
        <div>
          <label className="mb-2 block text-sm text-[#A9B8C9]">{p.messageLabel}</label>
          <textarea name="message" rows={4} className={fieldClass} />
        </div>

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full border border-gold bg-gold px-7 py-3.5 text-[15px] font-medium text-ink transition-colors hover:bg-[#F8F4EC] disabled:opacity-60"
        >
          {status === "loading" ? "..." : p.submit}
        </button>

        {status === "success" && <p className="text-sm text-gold">{p.successMessage}</p>}
        {status === "error" && <p className="text-sm text-red-400">{p.errorMessage}</p>}
      </form>
    </GlassPanel>
  );
}

export function ContactForm({ p, locale }: { p: Dictionary["pages"]["contact"]; locale?: Locale }) {
  const [status, setStatus] = useState<Status>("idle");

  if (locale === "he") {
    return <HeContactForm p={p} />;
  }

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
    "w-full rounded-xl border border-lineDark bg-paper px-4 py-3 text-navy outline-none transition-colors focus:border-gold/60";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="mb-2 block text-sm text-navy/60">{p.nameLabel}</label>
        <input name="name" type="text" required className={fieldClass} />
      </div>
      <div>
        <label className="mb-2 block text-sm text-navy/60">{p.emailLabel}</label>
        <input name="email" type="email" required className={fieldClass} />
      </div>
      <div>
        <label className="mb-2 block text-sm text-navy/60">{p.companyLabel}</label>
        <input name="company" type="text" className={fieldClass} />
      </div>
      <div>
        <label className="mb-2 block text-sm text-navy/60">{p.messageLabel}</label>
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
        <p className="text-sm text-gold">{p.successMessage}</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600">{p.errorMessage}</p>
      )}
    </form>
  );
}

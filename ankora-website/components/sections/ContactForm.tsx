"use client";

import { useState } from "react";
import type { Dictionary } from "@/content";

export function ContactForm({ p }: { p: Dictionary["pages"]["contact"] }) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
      className="space-y-5"
    >
      {(["nameLabel", "emailLabel", "companyLabel"] as const).map((key) => (
        <div key={key}>
          <label className="mb-2 block text-sm text-paper/60">{p[key]}</label>
          <input
            type={key === "emailLabel" ? "email" : "text"}
            required={key !== "companyLabel"}
            className="w-full rounded-xl border border-line bg-transparent px-4 py-3 text-paper outline-none transition-colors focus:border-lineGold"
          />
        </div>
      ))}
      <div>
        <label className="mb-2 block text-sm text-paper/60">{p.messageLabel}</label>
        <textarea
          rows={4}
          className="w-full rounded-xl border border-line bg-transparent px-4 py-3 text-paper outline-none transition-colors focus:border-lineGold"
        />
      </div>
      <button
        type="submit"
        className="rounded-full bg-gold-gradient px-7 py-3.5 text-[15px] font-medium text-ink transition-transform hover:scale-[1.02]"
      >
        {submitted ? "✓" : p.submit}
      </button>
    </form>
  );
}

"use client";

import { useId, useState } from "react";
import type { Dictionary } from "@/content";
import { GlassPanel } from "@/components/ui/GlassPanel";

type Status = "idle" | "loading" | "success" | "error";

/**
 * The one conversion GA4 should count: a contact request the server accepted.
 * The old key event, "Contact_us_page", fired on every view of /contact, so it
 * counted bots and browsers as leads (14 of its 32 hits in the 90 days to
 * 1.10.2026 came from US data centres). Mark generate_lead as the key event in
 * GA4 and retire Contact_us_page there. gtag is absent for automated browsers
 * (see the layout), and a failure here must never touch the form.
 */
function trackLead() {
  try {
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    gtag?.("event", "generate_lead", { form: "contact" });
  } catch {
    // Analytics is never allowed to break a submitted form.
  }
}

const FIELD =
  "w-full min-h-[44px] border border-[rgba(243,234,219,0.18)] bg-[rgba(11,27,51,0.5)] px-4 py-3 text-cream outline-none transition-colors duration-200 focus:border-gold focus:bg-[rgba(176,141,87,0.06)]";

/**
 * Contact form. Labels above the fields and no placeholders: with a visible label a
 * placeholder only repeats it, and it disappears at the moment the person starts
 * typing — exactly when they might still need it.
 *
 * One form for both locales; the endpoint and payload are unchanged. The email field
 * is the one LTR island inside an RTL form, aligned to the inline end so the caret
 * still starts where the eye does.
 */
export function ContactForm({ p }: { p: Dictionary["pages"]["contact"] }) {
  const [status, setStatus] = useState<Status>("idle");
  const id = useId();

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
      trackLead();
    } catch {
      setStatus("error");
    }
  }

  const label = "mb-2 block font-assistant text-sm text-muted";

  return (
    <GlassPanel elevated className="p-[clamp(22px,3vw,40px)]">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor={`${id}-name`} className={label}>
            {p.nameLabel}
          </label>
          <input id={`${id}-name`} name="name" type="text" autoComplete="name" required className={FIELD} />
        </div>
        <div>
          <label htmlFor={`${id}-email`} className={label}>
            {p.emailLabel}
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            autoComplete="email"
            required
            dir="ltr"
            className={`${FIELD} text-end`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-company`} className={label}>
            {p.companyLabel}
          </label>
          <input id={`${id}-company`} name="company" type="text" autoComplete="organization" className={FIELD} />
        </div>
        <div>
          <label htmlFor={`${id}-message`} className={label}>
            {p.messageLabel}
          </label>
          <textarea id={`${id}-message`} name="message" rows={4} className={FIELD} />
        </div>

        <button
          type="submit"
          disabled={status === "loading"}
          className="min-h-[44px] w-full border border-gold bg-gold px-7 py-3.5 font-assistant text-[15px] font-medium text-navy transition-colors duration-200 hover:bg-cream disabled:opacity-60"
        >
          {status === "loading" ? "..." : p.submit}
        </button>

        {/* aria-live so the outcome is announced, not just shown: the button label
            does not change and nothing receives focus on submit. */}
        <p aria-live="polite" className="font-assistant text-sm">
          {status === "success" && <span className="text-gold">{p.successMessage}</span>}
          {status === "error" && <span className="text-error-on-dark">{p.errorMessage}</span>}
        </p>
      </form>
    </GlassPanel>
  );
}

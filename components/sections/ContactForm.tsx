"use client";

import { useId, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import type { Dictionary } from "@/content";
import { GlassPanel } from "@/components/ui/GlassPanel";

type Status = "idle" | "loading" | "success" | "error";

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
  // Funnel events (see lib/analytics.ts). Each fires once per page view, so a
  // person who fixes a typo does not count twice.
  const started = useRef(false);
  const fieldsDone = useRef(new Set<string>());
  const invalidReported = useRef(false);

  function onFirstInteraction() {
    if (started.current) return;
    started.current = true;
    track("contact_form_start", { form: "contact" });
  }

  function onFieldBlur(e: React.FocusEvent<HTMLFormElement>) {
    const el = e.target as unknown as HTMLInputElement | HTMLTextAreaElement;
    if (!el.name || !el.value.trim() || fieldsDone.current.has(el.name)) return;
    fieldsDone.current.add(el.name);
    track("contact_form_field", { form: "contact", field: el.name, fields_done: fieldsDone.current.size });
  }

  function onInvalid(e: React.FormEvent<HTMLInputElement>) {
    // "invalid" fires once per bad field; report the first one per attempt.
    if (invalidReported.current) return;
    invalidReported.current = true;
    track("contact_form_invalid", { form: "contact", field: e.currentTarget.name });
    setTimeout(() => (invalidReported.current = false), 0);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    track("contact_form_submit", { form: "contact", fields_done: fieldsDone.current.size });
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

      if (!res.ok) {
        track("contact_form_error", { form: "contact", reason: `http_${res.status}` });
        setStatus("error");
        return;
      }

      setStatus("success");
      form.reset();
      // The one conversion GA4 should count: a request the server accepted.
      // Marked as the key event in GA4; the old Contact_us_page (fired on every
      // view of /contact) was unmarked on 1.10.2026.
      track("generate_lead", { form: "contact" });
    } catch {
      track("contact_form_error", { form: "contact", reason: "network" });
      setStatus("error");
    }
  }

  const label = "mb-2 block font-assistant text-sm text-muted";

  return (
    <GlassPanel elevated className="p-[clamp(22px,3vw,40px)]">
      <form
        onSubmit={handleSubmit}
        onFocus={onFirstInteraction}
        onInput={onFirstInteraction}
        onBlur={onFieldBlur}
        className="space-y-5"
      >
        <div>
          <label htmlFor={`${id}-name`} className={label}>
            {p.nameLabel}
          </label>
          <input id={`${id}-name`} name="name" type="text" autoComplete="name" required onInvalid={onInvalid} className={FIELD} />
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
            onInvalid={onInvalid}
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

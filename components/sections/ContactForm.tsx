"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics";
import { BOOKING_EMBED_URL, WHATSAPP_URL } from "@/lib/contact-links";
import type { Dictionary, Locale } from "@/content";

type Status = "idle" | "loading" | "booking" | "error";

const FIELD =
  "w-full min-h-[48px] border border-[rgba(243,234,219,0.18)] bg-[rgba(11,27,51,0.5)] px-4 py-3 text-base text-cream outline-none transition-colors duration-200 focus:border-gold focus:bg-[rgba(176,141,87,0.06)]";

// A chip is a real checkbox, visually hidden, inside its label: the label is the
// target, keyboard and screen readers get the native control.
const CHIP =
  "inline-flex min-h-[44px] cursor-pointer select-none items-center justify-center gap-1.5 border border-[rgba(243,234,219,0.18)] px-3.5 py-2 font-assistant text-[15px] text-cream transition-colors hover:border-[rgba(176,141,87,0.6)] has-[:checked]:border-gold has-[:checked]:bg-[rgba(176,141,87,0.14)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold";

/** "1 Details  2 Pick a time": the meeting is the second step, not an extra. */
function Steps({ p, current }: { p: Dictionary["pages"]["contact"]; current: 1 | 2 }) {
  const items = [p.stepDetails, p.stepBooking];
  return (
    <ol className="mb-6 grid grid-cols-2 gap-2" aria-label={`${current} / 2`}>
      {items.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} aria-current={active ? "step" : undefined}>
            <div className={`h-0.5 ${n <= current ? "bg-gold" : "bg-[rgba(243,234,219,0.14)]"}`} />
            <div className={`mt-2.5 flex items-center gap-2 font-assistant text-[13px] ${active ? "text-cream" : "text-[rgba(248,244,236,0.55)]"}`}>
              <span className="font-jbmono text-gold-light">{done ? "✓" : `0${n}`}</span>
              {label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Contact form, redesigned 2.10.2026 (claude/contact-page-redesign-2026-10.md),
 * revised the same day after Ariel reviewed the preview:
 *
 * - Step 1, details: name and email (required), phone (optional), the six areas of
 *   the home page as chips, a note. The button says where it leads.
 * - Step 2, the booking calendar, open as soon as the server accepts step 1. It is
 *   the natural next step, framed as such, not an option behind a button. The lead
 *   is already saved, so a person who books nothing is still a lead.
 *
 * The funnel (lib/analytics.ts) is unchanged. booking_open fires when step 2 is
 * shown; contact_channel_click when the direct WhatsApp or email link is used.
 */
export function ContactForm({
  p,
  areas,
  locale,
}: {
  p: Dictionary["pages"]["contact"];
  areas: string[];
  locale: Locale;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const id = useId();
  // Funnel events. Each fires once per page view, so a person who fixes a typo
  // does not count twice.
  const started = useRef(false);
  const fieldsDone = useRef(new Set<string>());
  const invalidReported = useRef(false);
  const bookingRef = useRef<HTMLDivElement>(null);

  // Step 2 replaces the form. On a phone the submit button sits near the bottom of
  // the screen, so bring the calendar's heading into view.
  useEffect(() => {
    if (status !== "booking" || !bookingRef.current) return;
    track("booking_open", { form: "contact" });
    const top = bookingRef.current.getBoundingClientRect().top;
    if (top < 80 || top > window.innerHeight * 0.5) {
      bookingRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [status]);

  function onFirstInteraction() {
    if (started.current) return;
    started.current = true;
    track("contact_form_start", { form: "contact" });
  }

  function markField(name: string) {
    if (fieldsDone.current.has(name)) return;
    fieldsDone.current.add(name);
    track("contact_form_field", { form: "contact", field: name, fields_done: fieldsDone.current.size });
  }

  function onFieldBlur(e: React.FocusEvent<HTMLFormElement>) {
    const el = e.target as unknown as HTMLInputElement | HTMLTextAreaElement;
    if (!el.name || el.type === "checkbox" || !el.value.trim()) return;
    markField(el.name);
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
    const data = new FormData(e.currentTarget);
    const chosenAreas = data.getAll("areas").map(String);
    const phone = String(data.get("phone") ?? "").trim();
    setStatus("loading");
    track("contact_form_submit", {
      form: "contact",
      fields_done: fieldsDone.current.size,
      has_phone: phone !== "",
      areas_count: chosenAreas.length,
    });

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          phone,
          areas: chosenAreas,
          message: data.get("message"),
        }),
      });

      if (!res.ok) {
        track("contact_form_error", { form: "contact", reason: `http_${res.status}` });
        setStatus("error");
        return;
      }

      // The one conversion GA4 counts: a request the server accepted.
      track("generate_lead", { form: "contact", has_phone: phone !== "" });
      setStatus("booking");
    } catch {
      track("contact_form_error", { form: "contact", reason: "network" });
      setStatus("error");
    }
  }

  const label = "mb-2 block font-assistant text-sm text-[rgba(248,244,236,0.7)]";
  const panel = "border border-[rgba(243,234,219,0.12)] bg-[rgba(243,234,219,0.04)] p-[clamp(18px,3vw,40px)]";

  if (status === "booking") {
    return (
      <div ref={bookingRef} className={`scroll-mt-24 ${panel}`}>
        <Steps p={p} current={2} />
        {/* Announced: the form is replaced, nothing else would tell a screen reader. */}
        <div role="status">
          <h2 className="text-[clamp(1.5rem,2.4vw,2rem)] font-extralight leading-[1.25] text-cream">{p.bookingTitle}</h2>
          <p className="mt-2 font-assistant text-base font-light leading-[1.7] text-muted">{p.bookingSub}</p>
        </div>
        {/* Google's own booking page: white, and it cannot be styled. It sits on a
            white ground so it reads as a deliberate panel, not a broken one. */}
        <div className="mt-6 bg-white">
          <iframe src={BOOKING_EMBED_URL} title={p.stepBooking} className="block h-[700px] w-full border-0" />
        </div>
        <p className="mt-4 text-center font-assistant text-[13px] leading-relaxed text-[rgba(248,244,236,0.55)]">{p.bookingFallback}</p>
      </div>
    );
  }

  return (
    <div>
      <form
        onSubmit={handleSubmit}
        onFocus={onFirstInteraction}
        onInput={onFirstInteraction}
        onBlur={onFieldBlur}
        className={panel}
      >
        <Steps p={p} current={1} />
        <div className="flex flex-col gap-6">
          <div>
            <label htmlFor={`${id}-name`} className={label}>
              {p.nameLabel}
            </label>
            <input id={`${id}-name`} name="name" type="text" autoComplete="name" required onInvalid={onInvalid} className={FIELD} />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
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
              <label htmlFor={`${id}-phone`} className={label}>
                {p.phoneLabel}
              </label>
              <input
                id={`${id}-phone`}
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                className={`${FIELD} text-end`}
              />
            </div>
          </div>

          <fieldset>
            <legend className={label}>{p.areasLabel}</legend>
            <div className="flex flex-wrap gap-2">
              {areas.map((area) => (
                <label key={area} className={CHIP}>
                  <input type="checkbox" name="areas" value={area} onChange={() => markField("areas")} className="peer sr-only" />
                  <svg className="hidden peer-checked:block" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#C7AC7E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {area}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={`${id}-message`} className={label}>
              {p.messageLabel}
            </label>
            <textarea id={`${id}-message`} name="message" rows={2} className={`${FIELD} resize-y`} />
          </div>

          <div>
            <button
              type="submit"
              disabled={status === "loading"}
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 border border-gold bg-gold px-7 py-3.5 font-assistant text-base font-semibold text-navy transition-colors duration-200 hover:border-cream hover:bg-cream disabled:opacity-60"
            >
              {status === "loading" ? "..." : p.submit}
              {status !== "loading" && (
                <svg className="rtl:rotate-180" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              )}
            </button>
            <p className="mt-3 text-center font-assistant text-[13px] text-[rgba(248,244,236,0.55)]">
              {p.privacy}{" "}
              <Link href={`/${locale}/privacy`} className="text-gold-light underline decoration-[rgba(176,141,87,0.45)] underline-offset-4 hover:text-cream">
                {p.privacyLink}
              </Link>
            </p>
            {/* aria-live so a failure is announced, not just shown. */}
            <p aria-live="polite" className="mt-2 text-center font-assistant text-sm">
              {status === "error" && <span className="text-error-on-dark">{p.errorMessage}</span>}
            </p>
          </div>
        </div>
      </form>

      <p className="mt-4 text-center font-assistant text-sm text-[rgba(248,244,236,0.6)]">
        {p.whatsappPrompt}{" "}
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("contact_channel_click", { form: "contact", channel: "whatsapp_link" })}
          className="inline-flex min-h-[44px] items-center text-gold-light underline decoration-[rgba(176,141,87,0.45)] underline-offset-4 hover:text-cream"
        >
          {p.whatsappLink}
        </a>
        {" · "}
        <a
          href="mailto:hello@ankora.co.il"
          dir="ltr"
          onClick={() => track("contact_channel_click", { form: "contact", channel: "email_link" })}
          className="inline-flex min-h-[44px] items-center font-jbmono text-[13px] text-gold-light underline decoration-[rgba(176,141,87,0.45)] underline-offset-4 hover:text-cream"
        >
          hello@ankora.co.il
        </a>
      </p>
    </div>
  );
}

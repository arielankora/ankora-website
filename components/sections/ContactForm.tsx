"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics";
import { BOOKING_EMBED_URL, WHATSAPP_URL } from "@/lib/contact-links";
import type { Dictionary, Locale } from "@/content";

type Status = "idle" | "loading" | "success" | "error";
type Channel = Dictionary["pages"]["contact"]["channels"][number];

const FIELD =
  "w-full min-h-[48px] border border-[rgba(243,234,219,0.18)] bg-[rgba(11,27,51,0.5)] px-4 py-3 text-base text-cream outline-none transition-colors duration-200 focus:border-gold focus:bg-[rgba(176,141,87,0.06)]";

// A chip is a real radio or checkbox, visually hidden, inside its label: the label
// is the target, keyboard and screen readers get the native control.
const CHIP =
  "inline-flex min-h-[44px] cursor-pointer select-none items-center justify-center gap-1.5 border border-[rgba(243,234,219,0.18)] px-3.5 py-2 font-assistant text-[15px] text-cream transition-colors hover:border-[rgba(176,141,87,0.6)] has-[:checked]:border-gold has-[:checked]:bg-[rgba(176,141,87,0.14)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold";

/**
 * Contact form, redesigned 2.10.2026 (claude/contact-page-redesign-2026-10.md).
 *
 * What changed, and why:
 * - Reply channel first. WhatsApp, phone or email, and one field for the chosen one.
 *   Email used to be the only way back, in a country where WhatsApp is the default.
 * - The six areas of the home page as chips, instead of an empty "how can we help".
 * - After the server accepts the request, the booking calendar opens inside the
 *   card. The lead is already saved, so booking is a bonus, never a gate.
 *
 * The funnel (lib/analytics.ts) is unchanged and two events are added:
 * contact_channel_click for the direct WhatsApp link, and booking_open when the
 * calendar is opened after a successful request.
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
  const [channel, setChannel] = useState<Channel>(p.channels[0]);
  const [bookingOpen, setBookingOpen] = useState(false);
  const id = useId();
  // Funnel events. Each fires once per page view, so a person who fixes a typo
  // does not count twice.
  const started = useRef(false);
  const fieldsDone = useRef(new Set<string>());
  const invalidReported = useRef(false);
  // On a phone the submit button is near the bottom of the screen, so the
  // confirmation that replaces the form would start above the viewport.
  const successRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status !== "success" || !successRef.current) return;
    const top = successRef.current.getBoundingClientRect().top;
    if (top < 80 || top > window.innerHeight * 0.6) {
      successRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
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
    if (!el.name || el.type === "radio" || el.type === "checkbox" || !el.value.trim()) return;
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
    const form = e.currentTarget;
    const data = new FormData(form);
    const chosenAreas = data.getAll("areas").map(String);
    setStatus("loading");
    track("contact_form_submit", {
      form: "contact",
      fields_done: fieldsDone.current.size,
      channel: channel.id,
      areas_count: chosenAreas.length,
    });

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          channel: channel.id,
          contact: data.get("contact"),
          areas: chosenAreas,
          message: data.get("message"),
        }),
      });

      if (!res.ok) {
        track("contact_form_error", { form: "contact", reason: `http_${res.status}` });
        setStatus("error");
        return;
      }

      setStatus("success");
      // The one conversion GA4 counts: a request the server accepted.
      track("generate_lead", { form: "contact", channel: channel.id });
    } catch {
      track("contact_form_error", { form: "contact", reason: "network" });
      setStatus("error");
    }
  }

  const label = "mb-2 block font-assistant text-sm text-[rgba(248,244,236,0.7)]";

  if (status === "success") {
    return (
      <div ref={successRef} className="scroll-mt-24 border border-[rgba(176,141,87,0.45)] bg-[rgba(243,234,219,0.04)] p-[clamp(22px,3vw,40px)]">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#C7AC7E" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="m8 12 3 3 5-6" />
        </svg>
        {/* Announced: the form is replaced, nothing else would tell a screen reader. */}
        <div role="status">
          <h2 className="mt-4 text-[clamp(1.6rem,2.6vw,2.1rem)] font-extralight leading-[1.2] text-cream">{p.successTitle}</h2>
          <p className="mt-3 font-assistant text-[17px] font-light leading-[1.7] text-muted">{channel.reply}</p>
        </div>

        <div className="mt-8 border-t border-[rgba(243,234,219,0.12)] pt-7">
          <p className="font-assistant text-[13px] font-semibold tracking-[0.14em] text-gold-light">{p.bookingEyebrow}</p>
          <p className="mb-5 mt-2 text-lg font-light text-cream">{p.bookingTitle}</p>
          {bookingOpen ? (
            // Google's own booking page. It is white and cannot be styled; it sits
            // on a white ground so it reads as a deliberate panel, not a broken one.
            <div className="bg-white">
              <iframe
                src={BOOKING_EMBED_URL}
                title={p.bookingCta}
                className="block h-[640px] w-full border-0"
                loading="lazy"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setBookingOpen(true);
                track("booking_open", { form: "contact", channel: channel.id });
              }}
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 border border-gold bg-gold px-7 py-3.5 font-assistant text-base font-semibold text-navy transition-colors duration-200 hover:border-cream hover:bg-cream"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
              {p.bookingCta}
            </button>
          )}
          <p className="mt-2.5 text-center font-assistant text-[13px] text-[rgba(248,244,236,0.55)]">{p.bookingNote}</p>
        </div>
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
        className="flex flex-col gap-6 border border-[rgba(243,234,219,0.12)] bg-[rgba(243,234,219,0.04)] p-[clamp(18px,3vw,40px)]"
      >
        <div>
          <label htmlFor={`${id}-name`} className={label}>
            {p.nameLabel}
          </label>
          <input id={`${id}-name`} name="name" type="text" autoComplete="name" required onInvalid={onInvalid} className={FIELD} />
        </div>

        <fieldset>
          <legend className={label}>{p.channelLabel}</legend>
          <div className="grid grid-cols-3 gap-2">
            {p.channels.map((c) => (
              <label key={c.id} className={CHIP}>
                <input
                  type="radio"
                  name="channel"
                  value={c.id}
                  checked={channel.id === c.id}
                  onChange={() => {
                    setChannel(c);
                    markField("channel");
                  }}
                  className="sr-only"
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={`${id}-contact`} className={label}>
            {channel.field}
          </label>
          {/* key: a new input per channel, so a phone number typed under
              WhatsApp does not linger in an email field, and the browser's
              autofill and keyboard match the type. */}
          <input
            key={channel.id}
            id={`${id}-contact`}
            name="contact"
            type={channel.id === "email" ? "email" : "tel"}
            inputMode={channel.id === "email" ? "email" : "tel"}
            autoComplete={channel.id === "email" ? "email" : "tel"}
            required
            onInvalid={onInvalid}
            dir="ltr"
            className={`${FIELD} text-end`}
          />
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
            className="min-h-[52px] w-full border border-gold bg-gold px-7 py-3.5 font-assistant text-base font-semibold text-navy transition-colors duration-200 hover:border-cream hover:bg-cream disabled:opacity-60"
          >
            {status === "loading" ? "..." : p.submit}
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

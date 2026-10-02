import { NextResponse } from "next/server";
import { rateLimitResponse } from "@/lib/rate-limit";

// Security review (OWASP API4:2023 - Unrestricted Resource Consumption).
// This endpoint is unauthenticated and every successful call sends a real
// email through Resend to info@ankora.co.il. With no ceiling it is an
// open relay for flooding that inbox and for burning the Resend quota
// (which, once exhausted, silently breaks the real contact form - a
// denial of service against Ankora's own lead flow).
//
// 5 submissions per IP per 10 minutes: far above any legitimate human
// rate, far below a useful flooding rate.
const CONTACT_LIMIT = 5;
const CONTACT_WINDOW_MS = 10 * 60 * 1000;

// Field ceilings. Unbounded strings meant a single request could push a
// multi-megabyte body into an email; these are generous for a genuine
// inquiry and bound the payload.
const MAX_NAME = 200;
const MAX_EMAIL = 320; // RFC 5321 maximum address length
const MAX_MESSAGE = 5000;
const MAX_AREAS = 12;
const MAX_AREA = 80;

// The redesigned form (2.10.2026) asks how to reply: WhatsApp, phone or email,
// and one contact field for that channel. The old shape ({ name, email, company,
// message }) is still accepted, so a page cached before the deploy keeps working.
const CHANNELS = ["whatsapp", "phone", "email"] as const;
type Channel = (typeof CHANNELS)[number];
const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", phone: "Phone", email: "Email" };

// An Israeli or international number: digits with optional +, spaces, dashes,
// dots and brackets, 9 to 15 digits in all. Lenient on purpose: a person who
// typed their number a little oddly is still a lead.
const PHONE_RE = /^\+?[\d\s\-().]{8,24}$/;
function digitCount(v: string) {
  return v.replace(/\D/g, "").length;
}

// Deliberately permissive - just enough to reject values that are not
// addresses at all (and that would land in Resend's reply_to field).
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export async function POST(request: Request) {
  const limited = await rateLimitResponse(request.headers, "contact", CONTACT_LIMIT, CONTACT_WINDOW_MS);
  if (limited) return limited;

  try {
    const body = await request.json();
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const name = str(body.name, MAX_NAME);
    const message = str(body.message, MAX_MESSAGE);
    const company = str(body.company, 200);
    const areas: string[] = Array.isArray(body.areas)
      ? body.areas.filter((a: unknown) => typeof a === "string").slice(0, MAX_AREAS).map((a: string) => a.trim().slice(0, MAX_AREA)).filter(Boolean)
      : [];

    const channel: Channel = CHANNELS.includes(body.channel) ? body.channel : "email";
    const contact = str(body.contact ?? body.email, MAX_EMAIL);
    const email = channel === "email" ? contact : "";
    const phone = channel === "email" ? "" : contact;

    if (!name || !contact) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // An unvalidated value here was passed straight through to Resend's
    // `reply_to`. Resend takes JSON so there is no CRLF header-injection
    // path, but a malformed address still silently breaks every reply
    // Ankora tries to send back to a genuine lead.
    if (email && !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }
    if (phone && (!PHONE_RE.test(phone) || digitCount(phone) < 9 || digitCount(phone) > 15)) {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY is not set");
      return NextResponse.json({ error: "Server not configured" }, { status: 500 });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Ankora Website <noreply@ankora.co.il>",
        to: ["info@ankora.co.il"],
        ...(email ? { reply_to: email } : {}),
        subject: `New website inquiry from ${name} (${CHANNEL_LABEL[channel]})`,
        text: [
          `Name: ${name}`,
          `Reply by: ${CHANNEL_LABEL[channel]}`,
          email ? `Email: ${email}` : `Phone: ${phone}`,
          ...(phone && channel === "whatsapp" ? [`WhatsApp: https://wa.me/${phone.replace(/\D/g, "").replace(/^0/, "972")}`] : []),
          `Areas: ${areas.length ? areas.join(", ") : "-"}`,
          ...(company ? [`Company: ${company}`] : []),
          "",
          "Message:",
          message || "-",
        ].join("\n"),
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend API error:", emailRes.status, errText);
      return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Contact form error:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

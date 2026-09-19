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
const MAX_COMPANY = 200;
const MAX_MESSAGE = 5000;

// Deliberately permissive - just enough to reject values that are not
// addresses at all (and that would land in Resend's reply_to field).
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export async function POST(request: Request) {
  const limited = rateLimitResponse(request.headers, "contact", CONTACT_LIMIT, CONTACT_WINDOW_MS);
  if (limited) return limited;

  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";
    const email = typeof body.email === "string" ? body.email.trim().slice(0, MAX_EMAIL) : "";
    const company = typeof body.company === "string" ? body.company.trim().slice(0, MAX_COMPANY) : "";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";

    if (!name || !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // An unvalidated value here was passed straight through to Resend's
    // `reply_to`. Resend takes JSON so there is no CRLF header-injection
    // path, but a malformed address still silently breaks every reply
    // Ankora tries to send back to a genuine lead.
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
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
        reply_to: email,
        subject: `New website inquiry from ${name}`,
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          `Company: ${company || "-"}`,
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

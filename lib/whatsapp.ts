/// Portal phase 2. The deep link to a client's own WhatsApp thread.
///
/// This is the whole WhatsApp integration in the portal, and
/// deliberately so: a link the browser hands to WhatsApp needs no API, no
/// BSP, no template approval and no subprocessor, which is why it can
/// ship while the outbound-message questions are still open (see
/// claude/whatsapp-integration-2026-09.md in the project notes). The
/// portal shortens the way to a conversation the client already has; it
/// does not open a channel.
///
/// Returns null when no number is recorded, and every caller renders the
/// absence rather than a dead button.

/// wa.me wants digits only, in international form and without a plus.
/// Israeli numbers are stored however whoever typed them felt like, so
/// "052-123-4567", "+972 52 123 4567" and "972521234567" all have to
/// reach the same thread.
export function normalizeWhatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  // A local Israeli number: drop the trunk zero and prefix the country
  // code. Anything already carrying a country code is left alone - this
  // must not "fix" a foreign number into an Israeli one.
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return digits;
}

export function whatsappHref(raw: string | null | undefined, message?: string): string | null {
  const number = normalizeWhatsappNumber(raw);
  if (!number) return null;
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${number}${query}`;
}

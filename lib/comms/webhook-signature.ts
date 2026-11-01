import crypto from "node:crypto";

// Unipile v2 signs every webhook delivery (developer.unipile.com, "Configure
// a webhook", read 1.11.2026):
//   unipile-signature: t=<unix seconds>,v0=<hex HMAC-SHA256>
// over `${t}.${rawBody}` with the endpoint's secret. The body is checked
// exactly as received, before it is parsed. A delivery older than five
// minutes is refused, so a captured one cannot be replayed later.

export const SIGNATURE_MAX_AGE_SECONDS = 300;

export function parseSignatureHeader(header: string | null): { t: number; v0: string } | null {
  if (!header) return null;
  let t: number | null = null;
  let v0: string | null = null;
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && /^\d{1,12}$/.test(v ?? "")) t = Number(v);
    if (k === "v0" && /^[0-9a-f]{64}$/i.test(v ?? "")) v0 = v!.toLowerCase();
  }
  return t !== null && v0 ? { t, v0 } : null;
}

export function verifyUnipileSignature(params: {
  header: string | null;
  rawBody: string;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const parsed = parseSignatureHeader(params.header);
  if (!parsed || !params.secret) return false;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.t) > SIGNATURE_MAX_AGE_SECONDS) return false;
  const expected = crypto.createHmac("sha256", params.secret).update(`${parsed.t}.${params.rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parsed.v0, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

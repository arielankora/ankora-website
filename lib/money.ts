/// Portal phase 2. Money is stored in agorot everywhere (see
/// schema.prisma on Client.approvalCeilingMinor) and read by people in
/// shekels, so exactly one place does the conversion.
///
/// Not "server-only": an approval amount is rendered on both sides of the
/// wire, and a second copy of this arithmetic in a client component is
/// how two screens end up disagreeing about the same number.

/// 149.90 in, 14990 out. Returns null for an empty field rather than 0,
/// because "no amount" and "free" are different answers.
export function shekelsToMinor(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(/[,\s₪]/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/// 14990 in, "149.90 ₪" out. Whole amounts lose the decimals, because
/// "500 ₪" is what a person writes and "500.00 ₪" is what a system does.
export function formatMinor(minor: number | null | undefined): string | null {
  if (minor === null || minor === undefined) return null;
  const shekels = minor / 100;
  const text = Number.isInteger(shekels)
    ? shekels.toLocaleString("he-IL")
    : shekels.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${text} ₪`;
}

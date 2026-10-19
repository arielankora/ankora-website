// Spec 3.10, "ממתין לקבלה": a date on which something is due to reach us
// from outside ("דוח ספקים פתוחים, איילה שולחת כל חודש"). It is an
// ordinary date; what changes is what it asks of the person responsible:
// not to do something, but to make sure it came. Pure, so the screens, the
// daily job and the tests read it the same way.

export const RECEIPT_LABEL = "ממתין לקבלה";

type ReceiptDate = { title: string; expectsReceipt?: boolean | null; expectedFrom?: string | null };

const from = (d: ReceiptDate) => (d.expectedFrom?.trim() ? ` (מ-${d.expectedFrom.trim()})` : "");

/// The reminder's title.
export function reminderTitle(d: ReceiptDate): string {
  return d.expectsReceipt ? `${RECEIPT_LABEL}: ${d.title}${from(d)}` : d.title;
}

/// The task the date opens, when it opens one.
export function autoTaskTitle(d: ReceiptDate): string {
  return (d.expectsReceipt ? `לוודא שהתקבל: ${d.title}${from(d)}` : d.title).slice(0, 200);
}

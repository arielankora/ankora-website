import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

// Vault alerts (decision 8, 6.10.2026: "אריאל בלבד בשלב 1").
//
// Three events send mail: a step-up lockout, a user hitting the hourly
// reveal ceiling, and one user opening more than ten different
// credentials within an hour. None of them blocks anything on its own -
// the rate limits do that - they make sure a human hears about it the
// same day rather than in next month's audit review.
//
// The address is an env var with Ariel's as the default, so changing who
// is told is a setting, not a deploy. Never put a secret in the body:
// names, counts and times only.

const DEFAULT_RECIPIENT = "ariel@ankora.co.il";

export async function sendVaultAlert(subject: string, lines: string[]): Promise<void> {
  const to = (process.env.VAULT_ALERT_EMAIL || DEFAULT_RECIPIENT)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const text = [...lines, "", "הפרטים המלאים ביומן הפעולות."].join("\n");
  try {
    const result = await sendEmail({ to, subject: `כספת הגישות: ${subject}`, text });
    await prisma.emailDelivery.create({
      data: {
        template: "vault_alert",
        recipients: to,
        status: result.ok ? "SENT" : "FAILED",
        providerMessageId: result.providerMessageId ?? null,
        error: result.error ?? null,
      },
    });
  } catch {
    // An alert that fails to send must never turn a refusal into an
    // error page, and must never undo the audit row already written.
  }
}

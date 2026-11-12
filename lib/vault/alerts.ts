import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { groupEmailsByLocale } from "@/lib/i18n/recipients";
import type { OutgoingT } from "@/lib/i18n/outgoing";

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

/// The words are built per recipient language (ADR 0006, outgoing
/// channels): each address that belongs to an app user gets their
/// language, any other address Hebrew, one email per language.
export async function sendVaultAlert(words: (t: OutgoingT) => { subject: string; lines: string[] }): Promise<void> {
  const to = (process.env.VAULT_ALERT_EMAIL || DEFAULT_RECIPIENT)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    for (const group of await groupEmailsByLocale(to)) {
      const { t } = group.out;
      const { subject, lines } = words(t);
      const text = [...lines, "", t("vault.footer")].join("\n");
      const fullSubject = t("vault.subject", { subject });
      const result = await sendEmail({ to: group.to, subject: fullSubject, text });
      await prisma.emailDelivery.create({
        data: {
          template: "vault_alert",
          recipients: group.to,
          subject: fullSubject,
          body: text,
          status: result.ok ? "SENT" : "FAILED",
          providerMessageId: result.providerMessageId ?? null,
          error: result.error ?? null,
        },
      });
    }
  } catch {
    // An alert that fails to send must never turn a refusal into an
    // error page, and must never undo the audit row already written.
  }
}

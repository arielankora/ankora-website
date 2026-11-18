"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { updateClaudeUsageSettings, type SettingsInput } from "@/lib/app-domain/claude-usage";
import { domainErrorText } from "@/lib/i18n/domain-errors";

// Claude usage measurement, stage 3 (17.11.2026): the settings form on
// /app/claude-usage. A plain form post: `listed:<userId>` for everyone the
// form shows, and `nonCowork:<userId>` ticked for someone who does not work
// in Cowork. (18.11.2026: the seat price and the multiplier left with the
// monthly threshold.) The domain checks the permission.

export async function saveClaudeUsageSettingsAction(formData: FormData) {
  const user = await requireUser();
  const days = formData.get("days") === "30" ? "30" : "7";
  // A checkbox that is not ticked is not sent, so the form lists everyone
  // it shows (`listed:<userId>`) and ticks `nonCowork:<userId>`.
  const nonCowork: Record<string, boolean> = {};
  for (const [key] of formData.entries()) {
    if (key.startsWith("listed:")) {
      const id = key.slice("listed:".length);
      nonCowork[id] = formData.has(`nonCowork:${id}`);
    }
  }
  const input: SettingsInput = { nonCowork };
  let outcome = "saved=1";
  try {
    await updateClaudeUsageSettings(user, input);
  } catch (err) {
    // A refusal comes back in the reader's language; anything else is a
    // real fault and is thrown.
    const message = await domainErrorText(err);
    if (!message) throw err;
    outcome = `error=${encodeURIComponent(message)}`;
  }
  revalidatePath("/app/claude-usage");
  redirect(`/app/claude-usage?days=${days}&${outcome}#settings`);
}

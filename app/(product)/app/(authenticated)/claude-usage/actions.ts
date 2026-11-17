"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { updateClaudeUsageSettings, type SettingsInput } from "@/lib/app-domain/claude-usage";
import { domainErrorText } from "@/lib/i18n/domain-errors";

// Claude usage measurement, stage 3 (17.11.2026): the "מושבים וסף" form on
// /app/claude-usage. A plain form post: fields `defaultSeat`, `multiplier`
// and `seat:<userId>` (empty puts the person back on the default seat).
// The domain checks the permission and the ranges.

function num(v: FormDataEntryValue | null): number | undefined {
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export async function saveClaudeUsageSettingsAction(formData: FormData) {
  const user = await requireUser();
  const days = formData.get("days") === "30" ? "30" : "7";
  const seats: Record<string, number | null> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("seat:")) continue;
    const n = num(value);
    seats[key.slice("seat:".length)] = n === undefined ? null : n;
  }
  const input: SettingsInput = { defaultSeatUsd: num(formData.get("defaultSeat")), multiplier: num(formData.get("multiplier")), seats };
  let outcome = "saved=1";
  try {
    await updateClaudeUsageSettings(user, input);
  } catch (err) {
    // A refusal (a seat or multiplier out of range) comes back in the
    // reader's language; anything else is a real fault and is thrown.
    const message = await domainErrorText(err);
    if (!message) throw err;
    outcome = `error=${encodeURIComponent(message)}`;
  }
  revalidatePath("/app/claude-usage");
  redirect(`/app/claude-usage?days=${days}&${outcome}#settings`);
}

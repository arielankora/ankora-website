"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { resolveSystemIssue } from "@/lib/app-domain/system-issues";
import { domainErrorText } from "@/lib/i18n/domain-errors";

// System issues (27.11.2026): closing an issue from /app/system-issues. A
// plain form post. The domain checks the permission. A refusal comes back
// in the reader's language; anything else is a real fault and is thrown,
// so it reaches onRequestError and becomes an issue itself.
export async function resolveSystemIssueAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("issueId") ?? "");
  const note = String(formData.get("note") ?? "");
  let outcome = "resolved=1";
  try {
    await resolveSystemIssue(user, id, note);
  } catch (err) {
    const message = await domainErrorText(err);
    if (!message) throw err;
    outcome = `error=${encodeURIComponent(message)}`;
  }
  revalidatePath("/app/system-issues");
  redirect(`/app/system-issues?${outcome}`);
}

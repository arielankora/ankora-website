"use server";
import { requireUser } from "@/lib/app-auth/session";
import { recordPromptCopy } from "@/lib/claude-usage/record";

// Claude usage measurement (17.11.2026): records that the signed-in person
// copied one of the prompts Ankora builds for Claude, with its length only.
// Lives in the route group because the buttons that call it sit on four
// different screens (tasks, important dates, a client's file, a procedure
// document, reports).
//
// Callers fire and forget it after the copy succeeded: it must never delay
// or undo the copy, so it never throws and always answers ok.
export async function recordPromptCopiedAction(input: { kind: string; chars: number }) {
  try {
    const user = await requireUser();
    await recordPromptCopy(user.id, input?.kind, input?.chars);
  } catch (err) {
    console.error("[claude-usage] could not record a prompt copy", err);
  }
  return { ok: true as const };
}

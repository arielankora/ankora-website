import "server-only";
import type { User } from "@prisma/client";
import type { CategoryPick } from "@/lib/mcp/category-pick";

// A category for a task that is born without one (15.11.2026).
//
// A task opened from WhatsApp messages had no category, and a task with
// no category cannot start a timer or take a manual entry: the person
// found out only when they clicked "הפעלת טיימר". The pick is the one
// create_task makes through Claude (lib/mcp/category-pick.ts, Ariel's
// call of 15.10.2026): the best fit by the task's words and this team's
// history, cheap to correct on the task's own screen.
//
// Dynamic import, as in employee-lifecycle.ts: the lookup module imports
// back into the app domain. Never throws: a pick that fails leaves the
// task without a category, exactly as before, and the timer button asks.
export async function pickCategoryForTask(actor: User, clientId: string, text: string): Promise<CategoryPick | null> {
  try {
    const { autoPickCategory } = await import("@/lib/mcp/lookup");
    return await autoPickCategory(actor, clientId, text);
  } catch {
    return null;
  }
}

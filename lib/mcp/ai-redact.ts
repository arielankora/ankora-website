import "server-only";
import { aiExcludedClientIds, aiExcludedTaskIds } from "@/lib/app-domain/ai-exclusion-db";

// 28.10.2026: "בלי AI" on the time-entry tools. An entry is time, and the
// time itself is not the material a client asked to keep away from AI; its
// task title and its note are. So an entry on a marked task keeps its
// minutes and loses both, and says so. An entry of a marked client is left
// out of a list altogether, since nothing of that client goes through here.
//
// A running timer is the exception: the person has to know it is running,
// so it stays, with the client blanked as well.

type Redactable = {
  clientId: string;
  taskId: string | null;
  note: string | null;
  task?: { title: string } | null;
  client?: { name: string } | null;
};

export async function redactEntriesForAi<T extends Redactable>(
  entries: T[],
  opts: { keepExcludedClients?: boolean } = {}
): Promise<{ entry: T; aiExcluded: boolean }[]> {
  const [clients, tasks] = await Promise.all([
    aiExcludedClientIds(entries.map((e) => e.clientId)),
    aiExcludedTaskIds(entries.flatMap((e) => (e.taskId ? [e.taskId] : []))),
  ]);
  const out: { entry: T; aiExcluded: boolean }[] = [];
  for (const entry of entries) {
    if (clients.has(entry.clientId)) {
      if (opts.keepExcludedClients) out.push({ entry: { ...entry, client: null, task: null, note: null }, aiExcluded: true });
      continue;
    }
    if (entry.taskId && tasks.has(entry.taskId)) {
      out.push({ entry: { ...entry, task: null, note: null }, aiExcluded: true });
      continue;
    }
    out.push({ entry, aiExcluded: false });
  }
  return out;
}

/// The marker a redacted row carries, so the model can say why a title
/// or a note is missing instead of inventing one.
export const AI_REDACTED = { aiExcluded: true, aiExcludedNote: 'Task and note hidden: marked "בלי AI" at the client\'s request.' } as const;

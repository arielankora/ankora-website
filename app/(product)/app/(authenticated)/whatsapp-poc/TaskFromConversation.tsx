"use client";
import Link from "next/link";
import { useActionState } from "react";
import { createTaskAction } from "../tasks/actions";

const input = "mt-1 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";
const label = "block text-xs font-medium text-app-text-secondary";

type State = Awaited<ReturnType<typeof createTaskAction>>;

/// "צור משימה מהשיחה" (1.11.2026). The same create path as the tasks
/// screen (createTaskAction: access to the client, audit, notifications).
/// Title and description are proposed from the conversation and the
/// person edits them before saving; nothing is saved by opening it.
export function TaskFromConversation(props: {
  clients: Array<{ id: string; name: string }>;
  defaultClientId: string | null;
  title: string;
  description: string;
}) {
  const [state, action, pending] = useActionState<State | undefined, FormData>(createTaskAction, undefined);
  if (state?.ok && state.created) {
    return (
      <p className="flex min-h-9 items-center gap-2 text-sm text-app-success">
        המשימה נוצרה.
        <Link href={`/app/tasks/${state.created.id}`} className="text-app-text-primary underline">
          לפתיחת המשימה
        </Link>
      </p>
    );
  }
  return (
    <details className="group relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-app-border-strong bg-white px-3 text-sm text-app-text-primary">
        צור משימה מהשיחה
      </summary>
      <form
        action={action}
        className="absolute end-0 z-20 mt-2 w-[min(28rem,calc(100vw-2rem))] space-y-3 rounded-xl border border-app-border bg-white p-4 shadow-lg"
      >
        <div>
          <label htmlFor="task-client" className={label}>
            לקוח
          </label>
          <select id="task-client" name="clientId" required defaultValue={props.defaultClientId ?? ""} className={input}>
            <option value="" disabled>
              בחירת לקוח
            </option>
            {props.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="task-title" className={label}>
            שם המשימה
          </label>
          <input id="task-title" name="title" required defaultValue={props.title} maxLength={200} className={input} />
        </div>
        <div>
          <label htmlFor="task-description" className={label}>
            פירוט (אפשר לערוך, ולהדביק תמלול)
          </label>
          <textarea id="task-description" name="description" rows={6} defaultValue={props.description} className={input} />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-app-text-primary">
          <input type="checkbox" name="urgent" className="size-5" />
          דחוף
        </label>
        <button type="submit" disabled={pending} className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-60">
          {pending ? "יוצר..." : "יצירת משימה"}
        </button>
        {state?.error ? (
          <p role="alert" className="text-sm text-app-error">
            {state.error}
          </p>
        ) : null}
      </form>
    </details>
  );
}

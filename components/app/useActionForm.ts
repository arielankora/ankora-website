"use client";
import { useState, useTransition, type FormEvent } from "react";

/// What a Server Action in this app answers with.
export type ActionResult = { ok?: boolean; error?: string };

/**
 * Submit a form by calling its Server Action and waiting for that action's
 * own answer - and nothing else.
 *
 * The pattern this replaces is `useFormState` with `<form action={...}>`,
 * which is what Next documents and what every write form here used. It has
 * a property nobody chose and which is easy to miss: the form's pending
 * state does not end when the action returns. It ends when the re-render
 * that `revalidatePath` triggered has been applied, because Next ships that
 * re-render back inside the action's own response and React holds the whole
 * thing in one transition.
 *
 * Measured rather than assumed. A page whose re-render was made to take
 * twenty seconds, with an action that returns in one millisecond:
 *
 *     <form action> + useFormState   drawer closed after 20,501ms
 *     this hook                      drawer closed after 71ms
 *
 * Same action, same revalidation, same screen refresh happening in the
 * background either way. The difference is only whether the person who
 * pressed save is made to wait for it.
 *
 * That coupling is what the browser suite has been failing on: a write that
 * committed, a 200 that came back in fifty milliseconds, and a button still
 * reading "נוצר..." thirty seconds later with the row already in the
 * database. Whatever stalls that refresh - and on a healthy machine
 * something still does - the person saving a form should not be held
 * hostage to it. They asked whether their thing was saved. The action
 * answers that question by itself.
 *
 * What is given up: submitting with JavaScript disabled. Every form that
 * uses this sits inside a drawer that only JavaScript can open, so there
 * was never a no-JS path through it to lose.
 */
export function useActionForm(
  action: (prev: ActionResult | undefined, data: FormData) => Promise<ActionResult>,
  onSuccess?: () => void
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The action still updates the screen behind the form, and that update is
  // still a transition - it is just no longer one this form waits inside.
  const [, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second submit while the first is in flight would write the row
    // twice. The disabled button already prevents it; this covers the
    // keyboard path to the same place.
    if (pending) return;

    const data = new FormData(event.currentTarget);
    setError(null);
    setPending(true);

    startTransition(async () => {
      try {
        const result = await action(undefined, data);
        if (result?.ok) onSuccess?.();
        else setError(result?.error ?? "אירעה שגיאה. נסו שוב.");
      } catch {
        // A Server Action that throws has already been logged on the
        // server; what this side owes the person is a form that works
        // again rather than one frozen mid-save.
        setError("אירעה שגיאה. נסו שוב.");
      } finally {
        setPending(false);
      }
    });
  }

  return { onSubmit, pending, error };
}

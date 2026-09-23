"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

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
 *
 * And one thing that had to be added back, twice.
 *
 * The refresh that `revalidatePath` asks for rides home inside the action's
 * response, and whether it ARRIVES turned out to be a coin. The same click,
 * on consecutive CI runs of the same screen, produced opposite results:
 * once the screen refreshed before the form could even say the write had
 * been accepted, once the write committed and the screen had still not
 * changed forty-five seconds later.
 *
 * The first attempt at a fix asked for a refresh explicitly, inside the
 * transition, right after the action returned. It did not hold. A run
 * caught the server's own answer and said so outright: the action's
 * response carried a rendered screen with the new record missing from it,
 * and the explicit refresh that followed changed nothing on the page.
 *
 * So the refresh is now asked for from an effect, after the transition
 * that carried the action has committed and this component is settled.
 * Nothing about it competes with the action's own response any more: the
 * screen is re-fetched once, from a normal render, the way it would be if
 * a person had asked for it.
 *
 * Why no test caught any of this for three releases: every other write
 * test in the browser suite reloads the page before asserting the result.
 * A test that reloads before it looks is not testing a refresh. Two specs
 * now assert the screen updating itself, and they reload nothing.
 */
export function useActionForm<R extends ActionResult>(
  action: (prev: R | undefined, data: FormData) => Promise<R>,
  onSuccess?: (result: R) => void
) {
  const [pending, setPending] = useState(false);
  /// The action's whole answer, kept because several of these actions say
  /// more than ok-or-error: an overlap the person may confirm, a one-time
  /// invite link to show. `error` and `ok` below are the common two read
  /// off it, so a form that needs nothing else never touches this.
  const [result, setResult] = useState<R | null>(null);
  /// Set only when the action itself threw, which `result` cannot carry.
  const [thrown, setThrown] = useState<string | null>(null);
  // The action still updates the screen behind the form, and that update is
  // still a transition - it is just no longer one this form waits inside.
  const [, startTransition] = useTransition();
  const router = useRouter();
  /// Bumped on every successful write, and watched by the effect below.
  /// A counter rather than a boolean because two saves in a row are two
  /// refreshes, and a boolean that is already true is a refresh that
  /// never happens.
  const [landed, setLanded] = useState(0);

  useEffect(() => {
    if (landed === 0) return;
    router.refresh();
  }, [landed, router]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second submit while the first is in flight would write the row
    // twice. The disabled button already prevents it; this covers the
    // keyboard path to the same place.
    if (pending) return;

    const data = new FormData(event.currentTarget);
    setResult(null);
    setThrown(null);
    setPending(true);

    startTransition(async () => {
      try {
        const answer = await action(undefined, data);
        setResult(answer);
        if (answer?.ok) {
          // onSuccess first, then the signal that asks for the refresh.
          // The refresh may unmount this form - that is what closing a
          // decision does - and a callback that never ran because its
          // component was already gone is a drawer that stays open on a
          // saved row.
          onSuccess?.(answer);
          setLanded((n) => n + 1);
        }
      } catch {
        // A Server Action that throws has already been logged on the
        // server; what this side owes the person is a form that works
        // again rather than one frozen mid-save.
        setThrown("אירעה שגיאה. נסו שוב.");
      } finally {
        setPending(false);
      }
    });
  }

  return {
    onSubmit,
    pending,
    result,
    error: thrown ?? result?.error ?? null,
    ok: result?.ok === true,
  };
}

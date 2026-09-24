"use client";
import { useRouter } from "next/navigation";
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
 * The second attempt asked for it from an effect, after the transition had
 * committed. Right idea, and it worked for every form that stays on the
 * screen - which is not the ones that matter. Five forms here sit in a
 * drawer and close it on success, and closing the drawer unmounts the
 * form in the same batched update that scheduled the effect. React does
 * not run the effects of a component it is removing. So Tasks, Clients,
 * Categories, Hour banks and Important dates asked for no refresh at all,
 * and whether the row appeared went back to being the coin this hook was
 * rewritten to get rid of.
 *
 * It is a macrotask now: after React has committed, and belonging to
 * nothing that can be unmounted. See askForRefresh below.
 *
 * Why no test caught any of this for three releases, and then caught it
 * in twenty milliseconds. Every other write test in the browser suite
 * reloads the page before asserting, and a test that reloads before it
 * looks is not testing a refresh. But the deeper reason is that a
 * question about one hook's behaviour was only ever asked by sampling a
 * twelve-minute browser suite. `tests/unit/use-action-form.test.tsx`
 * renders a drawer, submits a form and counts the refreshes.
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
  /// Ask the screen behind this form to re-read itself.
  ///
  /// Two things this deliberately is NOT, and the product spent three
  /// investigations learning each one.
  ///
  /// **Not an effect.** That is what it was, and it silently did nothing
  /// for the five forms that matter most. `onSuccess` above is a drawer's
  /// close for Tasks, Clients, Categories, Hour banks and Important
  /// dates: it unmounts this form, in the same batched update that would
  /// have scheduled the effect. React does not run the effects of a
  /// component it is removing, so those five screens never asked for a
  /// refresh at all, and whether the new row appeared came down to
  /// whether the revalidation riding inside the action's own response
  /// happened to arrive. That is the coin flip this hook was rewritten to
  /// get rid of, still being flipped, for half the forms in the product.
  ///
  /// **Not a direct call either.** Called straight from here it lands
  /// inside the transition carrying the action, folded into the same
  /// update as that action's response. That version was tried and it did
  /// not hold. A macrotask puts it after React has committed, which is
  /// the one thing the effect had right.
  ///
  /// And nothing cancels it on unmount, which is the entire point: the
  /// form is usually gone by the time it runs, and the list it is
  /// refreshing is not.
  function askForRefresh() {
    setTimeout(() => router.refresh(), 0);
  }

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
          onSuccess?.(answer);
          askForRefresh();
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

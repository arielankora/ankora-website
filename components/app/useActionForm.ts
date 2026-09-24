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
 * And one thing that had to be added back, three times.
 *
 * The refresh that `revalidatePath` asks for rides home inside the action's
 * response, and whether it ARRIVES turned out to be a coin. The same click,
 * on consecutive CI runs of the same screen, produced opposite results:
 * once the screen refreshed before the form could even say the write had
 * been accepted, once the write committed and the screen had still not
 * changed forty-five seconds later.
 *
 * Attempt one asked for a refresh explicitly, inside the transition, right
 * after the action returned. A run caught the server's own answer and said
 * so outright: the action's response carried a rendered screen with the new
 * record missing from it, and the explicit refresh folded into that same
 * update changed nothing.
 *
 * Attempt two asked for it from an effect, after the transition had
 * committed. Right idea, wrong owner. Five forms here sit in a drawer and
 * close it on success, and closing unmounts the form in the same batched
 * update that scheduled the effect. React does not run the effects of a
 * component it is removing, so Tasks, Clients, Categories, Hour banks and
 * Important dates asked for no refresh at all.
 *
 * Attempt three moved it off the component entirely, onto a macrotask that
 * nothing could unmount. It ran, and it lost a race. A trace of a failing
 * run, on a write that had already committed:
 *
 *     POST /app/tasks                55ms (200)
 *     GET  /app/tasks?_rsc=...       41ms (net::ERR_ABORTED)
 *
 * A timer set on the way out fires while Next is still applying the
 * action's response, and Next drops the newer request in favour of the one
 * already in flight - which does not carry the new row. Both lose.
 *
 * So the rule is not "an effect" and not "a macrotask". It is: **the
 * refresh is asked for by whichever component is still alive after the
 * write, from an effect, so that it runs after the commit that applied the
 * action's response.** For a form that stays on the screen that is this
 * hook, below. For the five that close a drawer it is the drawer, which
 * outlives them; see components/app/Drawer.tsx. Exactly one of the two
 * fires per write.
 *
 * Why no test caught any of this for three releases, and then caught it
 * in twenty milliseconds. Every other write test in the browser suite
 * reloads the page before asserting, and a test that reloads before it
 * looks is not testing a refresh. But the deeper reason is that a
 * question about one hook's behaviour was only ever asked by sampling a
 * twelve-minute browser suite. `tests/unit/use-action-form.test.tsx`
 * renders the real drawer, submits a form and counts the refreshes.
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
  /// Bumped on every accepted write, and watched by the effect below. A
  /// counter rather than a flag, because two saves in a row are two
  /// refreshes and a flag that is already set is a refresh that never
  /// happens.
  const [writes, setWrites] = useState(0);
  // The action still updates the screen behind the form, and that update is
  // still a transition - it is just no longer one this form waits inside.
  const [, startTransition] = useTransition();
  const router = useRouter();

  /// Ask the screen behind this form to re-read itself.
  ///
  /// Deliberately an effect, and deliberately one that does nothing when
  /// this form is being removed from the screen. A form inside a drawer
  /// closes that drawer on success and is unmounted in the same commit,
  /// and this effect will not run for it. That is correct: the drawer asks
  /// instead, from an effect of its own, and two components asking would
  /// be two requests for the same screen racing each other.
  useEffect(() => {
    if (writes === 0) return;
    router.refresh();
  }, [writes, router]);

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
          setWrites((n) => n + 1);
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

"use client";
import { useRouter } from "next/navigation";
import { createContext, startTransition, useContext, useEffect, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { OPEN_DRAWER_EVENT, OPEN_DRAWER_PARAM, PENDING_OPEN_KEY, type OpenDrawerDetail } from "./drawer-keys";

// Redesign direction A: replaces the old pattern of an inline "add" form
// sitting permanently above every list screen's table (Clients, Users,
// Tasks, Categories) - that pushed existing records below the fold on
// both desktop and mobile even when nothing was being added. The trigger
// is the screen's one primary action button; the form itself only
// renders once the drawer is opened, so list screens stay data-first.
//
// `children` is a plain ReactNode, not a render-prop function - every
// `page.tsx` that uses this is a Server Component, and a function
// cannot cross the server/client boundary as a prop (only serializable
// values and React elements can). Any form that wants to close its own
// drawer on success reads `useDrawerClose()` instead of receiving a
// callback prop.
//
// That hook is also where the refresh after a write lives, and the rest
// of this comment is why.
//
// Five forms in this product sit in this drawer and close it when the
// server says the write was accepted: Tasks, Clients, Categories, Hour
// banks and Important dates. Closing unmounts the form. So the form is
// the one component in the tree that cannot be trusted to ask the screen
// behind it to re-read itself: React does not run the effects of a
// component it is removing, and a timer scheduled on the way out fires
// while Next is still applying the action's own response, which cancels
// it. A CI trace caught exactly that, on a write that had already
// committed:
//
//     POST /app/tasks                55ms (200)
//     GET  /app/tasks?_rsc=...       41ms (net::ERR_ABORTED)
//
// The request went out and was thrown away, and nothing retried it. The
// row was in the database and not on the screen.
//
// The drawer is what survives that unmount, so the drawer is what asks.
// `closeAfterWrite` below closes and bumps a counter; the effect keyed on
// that counter runs after the commit that removed the form, which is the
// same commit in which the action's response was applied. By then there
// is nothing in flight for the refresh to lose a race to.
//
// Forms that stay on the screen keep asking for themselves, from
// `useActionForm`'s own effect. One refresh per write either way, asked
// for by whichever of the two is still alive to ask.
const DrawerCloseContext = createContext<() => void>(() => {});

/// Close this drawer because the write succeeded.
///
/// Not a general purpose close: this is the success path, and calling it
/// tells the screen behind the drawer that it now has something new to
/// read. The X and the backdrop do not go through here, because
/// dismissing a form changes nothing worth re-reading.
export function useDrawerClose() {
  return useContext(DrawerCloseContext);
}

export function Drawer({
  triggerLabel,
  title,
  children,
  openKey,
  triggerClassName = "",
}: {
  triggerLabel: string;
  title: string;
  children: ReactNode;
  /// When set, `?new=<openKey>` in the address opens this drawer on
  /// arrival, and an OPEN_DRAWER_EVENT carrying the same key opens it in
  /// place.
  openKey?: string;
  /// Extra classes for the trigger button, e.g. to hide it where another
  /// entry point already exists.
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!openKey) return;
    const w = window as unknown as Record<string, unknown>;
    if (w[PENDING_OPEN_KEY] === openKey) {
      delete w[PENDING_OPEN_KEY];
      setOpen(true);
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get(OPEN_DRAWER_PARAM) === openKey) {
      setOpen(true);
      // Dropped from the address without a navigation, so a reload or a
      // shared link does not reopen a form somebody already closed.
      url.searchParams.delete(OPEN_DRAWER_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenDrawerDetail>).detail;
      if (detail?.key === openKey) {
        detail.handled = true;
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_DRAWER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_DRAWER_EVENT, onOpen);
  }, [openKey]);
  /// Bumped once per accepted write. A counter rather than a flag: two
  /// saves in a row are two refreshes, and a flag that is already set is
  /// a refresh that never happens.
  const [writes, setWrites] = useState(0);
  const router = useRouter();

  /// Dismissal. Nothing was written, so nothing behind this needs to change.
  const dismiss = () => setOpen(false);

  const closeAfterWrite = () => {
    setOpen(false);
    setWrites((n) => n + 1);
  };

  // A navigation, not a refresh. This is the fifth attempt at the same
  // sentence and the first one that stops asking nicely.
  //
  // `router.refresh()` from here was correct in every way that could be
  // reasoned about: the drawer outlives the form, the effect runs after
  // the commit that applied the action's response, and the call sits
  // inside a transition. CI aborted the request anyway, three runs
  // running, at 41ms, 37ms and 46ms, on writes that had already
  // committed. And the action's own response carries no list to fall
  // back on: the last run counted the task rows in it and found zero in
  // twenty-three kilobytes.
  //
  // A local lab on the same Next version, built for production, under
  // the same route groups, with the same hook, the same drawer, the same
  // middleware, a loading.tsx above it and a page slow enough to hit the
  // fallback, delivers the row in the action response every time. So the
  // cause is something about this app that a lab cannot hold, and five
  // rounds of narrowing has not found it.
  //
  // What is left is to stop depending on the mechanism that keeps
  // failing. #98 did this on the decisions screen and wrote the reason
  // down: a refresh is a request, a navigation is not. A changed query
  // string is a different URL, so the router has to go and get it, and
  // there is no pending-fetch bookkeeping for anything to cancel.
  //
  // The cost is one short parameter in the address bar. Every screen
  // that builds its own links rebuilds them from the parameters it cares
  // about, so it does not survive the next thing the person clicks.
  useEffect(() => {
    if (writes === 0) return;
    // Read from `window` rather than `useSearchParams`, which would make
    // every page holding a drawer need a Suspense boundary it does not
    // otherwise want. This runs in an effect, so there is no server pass
    // to worry about.
    const url = new URL(window.location.href);
    // A timestamp and not the counter: the counter restarts at one
    // whenever this drawer remounts, and replacing a URL with the one it
    // already has is not a navigation at all.
    url.searchParams.set("w", String(Date.now()));
    startTransition(() => router.replace(`${url.pathname}${url.search}`, { scroll: false }));
  }, [writes, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-full bg-gold-gradient px-4 py-2.5 text-sm font-medium text-navy ${triggerClassName}`}
      >
        <Plus size={16} strokeWidth={2.25} />
        {triggerLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
          <button
            type="button"
            aria-label="סגירה"
            onClick={dismiss}
            className="absolute inset-0 bg-appNavy/30"
          />
          <div className="absolute inset-y-0 end-0 flex w-full max-w-sm flex-col border-s border-lineDark bg-white shadow-lg sm:max-w-md">
            <div className="flex items-center justify-between border-b border-lineDark px-5 py-4">
              <h2 className="text-base font-medium text-appNavy">{title}</h2>
              <button
                type="button"
                aria-label="סגירה"
                onClick={dismiss}
                className="text-appNavy/50 transition-colors hover:text-appNavy"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <DrawerCloseContext.Provider value={closeAfterWrite}>
                {children}
              </DrawerCloseContext.Provider>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

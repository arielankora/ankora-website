"use client";
import { createContext, startTransition, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// A credential row that can take itself off the screen.
//
// Deleting committed in CI and the row stayed: the refresh that should
// follow a write is the request this app has watched get aborted again
// and again (the long comment in components/app/Drawer.tsx). So the row
// does not wait for it. On a successful delete it hides at once, and the
// screen is re-read afterwards, from an effect that runs after the commit
// - the same order the drawer settled on - so the list catches up with
// whatever else changed without anyone watching a deleted row linger.

const HideContext = createContext<() => void>(() => {});

export function useHideRow() {
  return useContext(HideContext);
}

export function CredentialRowShell({ id, children }: { id: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!hidden) return;
    const url = new URL(window.location.href);
    url.searchParams.set("w", String(Date.now()));
    startTransition(() => router.replace(`${url.pathname}${url.search}`, { scroll: false }));
  }, [hidden, router]);

  if (hidden) return null;
  return (
    <div className="rounded-2xl border border-lineDark bg-white p-5" data-credential-row={id}>
      <HideContext.Provider value={() => setHidden(true)}>{children}</HideContext.Provider>
    </div>
  );
}

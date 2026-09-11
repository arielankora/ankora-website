"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";

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
const DrawerCloseContext = createContext<() => void>(() => {});

export function useDrawerClose() {
  return useContext(DrawerCloseContext);
}

export function Drawer({
  triggerLabel,
  title,
  children,
}: {
  triggerLabel: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-gold-gradient px-4 py-2.5 text-sm font-medium text-ink"
      >
        <Plus size={16} strokeWidth={2.25} />
        {triggerLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
          <button
            type="button"
            aria-label="סגירה"
            onClick={close}
            className="absolute inset-0 bg-navy/30"
          />
          <div className="absolute inset-y-0 end-0 flex w-full max-w-sm flex-col border-s border-lineDark bg-white shadow-lg sm:max-w-md">
            <div className="flex items-center justify-between border-b border-lineDark px-5 py-4">
              <h2 className="text-base font-medium text-navy">{title}</h2>
              <button
                type="button"
                aria-label="סגירה"
                onClick={close}
                className="text-navy/50 transition-colors hover:text-navy"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <DrawerCloseContext.Provider value={close}>{children}</DrawerCloseContext.Provider>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

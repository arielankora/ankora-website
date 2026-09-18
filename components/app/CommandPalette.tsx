"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Home } from "lucide-react";
import { NAV_ICONS } from "./nav-icons";

export const OPEN_COMMAND_PALETTE_EVENT = "ankora:open-command-palette";

type NavAction = { href: string; label: string };
type ClientOption = { id: string; name: string };

// App redesign (handoff README, App Shell section): "פלטת פקודות (⌘K /
// Ctrl+K, Esc לסגירה): מודאל 560px, 14vh מלמעלה, שדה חיפוש, קבוצות
// 'פעולות' ו'לקוחות'." Self-contained: listens for the ⌘K/Ctrl+K shortcut
// itself, and for a custom event so Sidebar's "חיפוש או פעולה" button can
// open the same instance without prop-drilling open state through AppShell.
export function CommandPalette({ actions, clients }: { actions: NavAction[]; clients: ClientOption[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeydown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      // Focus after the modal mounts.
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const filteredActions = useMemo(
    () => (q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions),
    [actions, q]
  );
  const filteredClients = useMemo(
    () => (q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients.slice(0, 6)),
    [clients, q]
  );

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="חיפוש ופעולות">
      <button type="button" aria-label="סגירה" onClick={() => setOpen(false)} className="absolute inset-0 bg-navy/30" />
      <div
        className="relative mx-auto flex max-h-[70vh] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-lineDark bg-white shadow-[0_30px_70px_rgba(11,27,51,0.3)]"
        style={{ marginTop: "14vh" }}
      >
        <div className="flex items-center gap-2.5 border-b border-lineDark px-4 py-3.5">
          <Search size={16} strokeWidth={1.75} className="shrink-0 text-navy/40" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש או פעולה"
            className="w-full bg-transparent text-sm text-navy outline-none placeholder:text-navy/40"
          />
          <kbd className="shrink-0 rounded border border-lineDark px-1.5 py-0.5 font-jbmono text-[10px] text-navy/40">Esc</kbd>
        </div>

        <div className="overflow-y-auto py-2">
          {filteredActions.length > 0 && (
            <div className="px-2 pb-2">
              <p className="px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-wide text-navy/35">פעולות</p>
              {filteredActions.map((a) => {
                const Icon = NAV_ICONS[a.href] ?? Home;
                return (
                  <button
                    key={a.href}
                    type="button"
                    onClick={() => go(a.href)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13px] text-navy hover:bg-paper"
                  >
                    <Icon size={16} strokeWidth={1.75} className="text-navy/50" />
                    {a.label}
                  </button>
                );
              })}
            </div>
          )}

          {filteredClients.length > 0 && (
            <div className="px-2 pb-2">
              <p className="px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-wide text-navy/35">לקוחות</p>
              {filteredClients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => go(`/app/clients/${c.id}`)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13px] text-navy hover:bg-paper"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold/50" aria-hidden="true" />
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {filteredActions.length === 0 && filteredClients.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-navy/50">אין תוצאות</p>
          )}
        </div>
      </div>
    </div>
  );
}

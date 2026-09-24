"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";

// Tasks phase 4: finding work.
//
// One component owning the search box and the two dropdowns, because all
// three write the same query string and the screen behind them is a
// Server Component that reads it. Anything that reads a filter from
// somewhere other than the URL is a filter that disappears when somebody
// reloads, shares a link, or comes back from a task.
//
// **The search does not fire while you type.** A debounced navigation per
// keystroke on this screen, which is the slowest in the product, means a
// list that reshuffles under the cursor and a server that renders four
// times for one word. Enter searches; the X clears. Explicit, quiet, and
// it never surprises anyone mid-sentence.

export function TaskFilters({
  clients,
  categories,
}: {
  clients: { id: string; name: string }[];
  categories: { id: string; name: string; clientId: string | null }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(params.get("q") ?? "");

  // The box follows the URL, not the other way around: arriving from a
  // link, a back button or a cleared filter should all show what is
  // actually being filtered on.
  useEffect(() => {
    setText(params.get("q") ?? "");
  }, [params]);

  const clientId = params.get("clientId") ?? "";

  /// Every control writes through here, so none of them can drop what
  /// another one set. A null value removes the key rather than leaving
  /// `?clientId=` behind, which would read as a filter that is set to
  /// nothing.
  function go(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    router.replace(query ? `/app/tasks?${query}` : "/app/tasks", { scroll: false });
  }

  // Global categories plus this client's own, the same filter the create
  // form uses. With no client chosen there is nothing to narrow by, so
  // the list stays whole rather than pretending to be scoped.
  const available = clientId
    ? categories.filter((c) => c.clientId === null || c.clientId === clientId)
    : categories;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Changing the search resets the category: a category chosen
          // for one client is rarely what somebody means after they
          // search for something else, and a stale narrow filter is how
          // a search comes back empty for no visible reason.
          go({ q: text.trim() || null });
        }}
        className="flex min-w-[260px] flex-1 items-center gap-2 rounded-full border border-lineDark bg-white px-4 py-2"
      >
        <Search size={15} className="shrink-0 text-appNavy/40" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="חיפוש במשימות"
          placeholder="חיפוש בכותרת, בתיאור, בשרשור ובשם הלקוח"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-appNavy outline-none placeholder:text-appNavy/35"
        />
        {text && (
          <button
            type="button"
            aria-label="ניקוי החיפוש"
            onClick={() => {
              setText("");
              go({ q: null });
            }}
            className="shrink-0 text-appNavy/40 hover:text-appNavy"
          >
            <X size={14} />
          </button>
        )}
      </form>

      <Select
        label="לקוח"
        value={clientId}
        options={[{ value: "", label: "כל הלקוחות" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
        // Changing the client clears the category with it. A
        // client-specific category left behind from the previous client
        // matches nothing, and an empty list with two filters set is a
        // screen nobody can debug.
        onChange={(v) => go({ clientId: v || null, categoryId: null })}
      />
      <Select
        label="קטגוריה"
        value={params.get("categoryId") ?? ""}
        options={[{ value: "", label: "כל הקטגוריות" }, ...available.map((c) => ({ value: c.id, label: c.name }))]}
        onChange={(v) => go({ categoryId: v || null })}
      />
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-full border border-lineDark bg-white px-3 py-2 text-[13px]">
      <span className="text-appNavy/50">{label}</span>
      <select
        // The visible span and the chosen option share this label, so
        // without an explicit name the accessible name would be the
        // field plus its current value, and would change every time
        // somebody picks something else.
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[160px] cursor-pointer truncate bg-transparent font-medium text-appNavy outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
//
// ---
//
// **This is a real HTML form now, and that is the point of this round.**
//
// It used to call `router.replace` from an onSubmit handler. On 25.9.2026
// the browser suite caught what that costs:
//
//     Expect "toHaveURL" with timeout 60000ms
//     64 × unexpected value "http://127.0.0.1:3100/app/tasks"
//
// Sixty seconds after pressing Enter, the address bar had not changed.
// Not slowly - at all. And intermittently: the same test passed on the
// two runs either side of it.
//
// In the App Router `router.replace` is not a page load, it is a fetch of
// an RSC payload, and the URL changes when that payload arrives. If the
// fetch is dropped, the URL never changes and nothing retries it. From
// where the person is sitting, they pressed Enter and the product did
// nothing.
//
// That is the same ghost the refresh investigation chased for five rounds
// and never caught (claude/refresh-after-write-2026-09-24.md). It was
// worked around there by having the write return its own row. There is no
// equivalent trick for a filter: the whole answer lives on the server.
//
// So: stop asking the router. A `<form method="get">` with a string
// action is plain HTML that Next does not intercept, so Enter produces an
// ordinary browser navigation. A navigation of that kind cannot be
// cancelled by bookkeeping in a router, because no router is involved.
//
// The cost is honest and worth naming: a full document load instead of a
// soft transition, on the slowest screen in the product. A reliable
// second beats an unreliable instant, and "sometimes nothing happens" is
// the worst state a control can be in. If the abort is ever explained and
// fixed, this can go back.
//
// The dropdowns submit the same form for the same reason, which is why
// `go()` is gone: there is now exactly one way this component changes the
// URL.

export function TaskFilters({
  clients,
  categories,
}: {
  clients: { id: string; name: string }[];
  categories: { id: string; name: string; clientId: string | null }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  const [text, setText] = useState(params.get("q") ?? "");

  // The box follows the URL, not the other way around: arriving from a
  // link, a back button or a cleared filter should all show what is
  // actually being filtered on.
  useEffect(() => {
    setText(params.get("q") ?? "");
  }, [params]);

  const clientId = params.get("clientId") ?? "";

  /// The filters this form does not own, carried through so that
  /// searching does not silently drop the status pill or the board view
  /// somebody was looking at.
  ///
  /// Only the ones that are actually set. An empty hidden input still
  /// submits, and `?status=&mine=` reads as a filter set to nothing.
  const CARRIED = ["status", "mine", "group", "view"] as const;
  const carried = CARRIED.map((key) => [key, params.get(key)] as const).filter(
    (pair): pair is readonly [(typeof CARRIED)[number], string] => !!pair[1]
  );

  /// Where the X goes: this same screen without `q`.
  ///
  /// A link rather than a submit, because submitting an empty box would
  /// leave `?q=` in the address bar - a filter that is set to nothing,
  /// which is exactly what the hidden inputs above avoid.
  const clearedHref = (() => {
    const next = new URLSearchParams();
    if (clientId) next.set("clientId", clientId);
    const categoryId = params.get("categoryId");
    if (categoryId) next.set("categoryId", categoryId);
    for (const [key, value] of carried) next.set(key, value);
    const query = next.toString();
    return query ? `/app/tasks?${query}` : "/app/tasks";
  })();

  // Global categories plus this client's own, the same filter the create
  // form uses. With no client chosen there is nothing to narrow by, so
  // the list stays whole rather than pretending to be scoped.
  const available = clientId
    ? categories.filter((c) => c.clientId === null || c.clientId === clientId)
    : categories;

  return (
    <form
      ref={formRef}
      method="get"
      action="/app/tasks"
      className="flex flex-wrap items-center gap-2.5"
    >
      {carried.map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}

      <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-full border border-lineDark bg-white px-4 py-2">
        <Search size={15} className="shrink-0 text-appNavy/40" />
        <input
          // Nameless while empty, so an empty box is not submitted at
          // all. A form sends every named field it has, and `?q=` is a
          // filter set to nothing - the same thing the hidden inputs
          // above are careful to avoid.
          name={text.trim() ? "q" : undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="חיפוש במשימות"
          placeholder="חיפוש בכותרת, בתיאור, בשרשור ובשם הלקוח"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-appNavy outline-none placeholder:text-appNavy/35"
        />
        {text && (
          <Link
            href={clearedHref}
            aria-label="ניקוי החיפוש"
            // The box empties before the navigation lands, so the control
            // does not sit there still showing the word it is removing.
            onClick={() => setText("")}
            className="shrink-0 text-appNavy/40 hover:text-appNavy"
          >
            <X size={14} />
          </Link>
        )}
      </div>

      <Select
        label="לקוח"
        name="clientId"
        value={clientId}
        options={[{ value: "", label: "כל הלקוחות" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
        // Changing the client clears the category with it. A
        // client-specific category left behind from the previous client
        // matches nothing, and an empty list with two filters set is a
        // screen nobody can debug. The router is used here and nowhere
        // else: clearing a field the form is about to submit has to
        // happen before the submit, and the simplest correct version of
        // that is to navigate with both decided.
        onChange={(v) => {
          const next = new URLSearchParams();
          if (v) next.set("clientId", v);
          if (text.trim()) next.set("q", text.trim());
          for (const [key, value] of carried) next.set(key, value);
          const query = next.toString();
          router.push(query ? `/app/tasks?${query}` : "/app/tasks");
        }}
      />
      <Select
        label="קטגוריה"
        name="categoryId"
        value={params.get("categoryId") ?? ""}
        options={[{ value: "", label: "כל הקטגוריות" }, ...available.map((c) => ({ value: c.id, label: c.name }))]}
        // Submits the form it sits in, so it travels the same reliable
        // path as Enter in the box.
        onChange={() => formRef.current?.requestSubmit()}
      />
    </form>
  );
}

function Select({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-full border border-lineDark bg-white px-3 py-2 text-[13px]">
      <span className="text-appNavy/50">{label}</span>
      <select
        // Same reason as the search box: an unset dropdown contributes
        // nothing to the query string rather than `?clientId=`.
        name={value ? name : undefined}
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

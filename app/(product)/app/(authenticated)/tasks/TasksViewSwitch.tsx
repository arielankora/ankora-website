"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { TASKS_VIEW_COOKIE, type TasksView } from "@/lib/tasks-view";

// The list / board switch. A client component only so that the choice is
// remembered when it is clicked, and only then: a link that arrives with
// `?view=list` (a status pill, "בפיקוח") shows the list without changing
// what this person picked. See lib/tasks-view.ts.

function remember(view: TasksView) {
  document.cookie = `${TASKS_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
}

export function TasksViewSwitch({ current, listHref, boardHref }: { current: TasksView; listHref: string; boardHref: string }) {
  const t = useTranslations("tasks.list.view");
  const items: { view: TasksView; href: string; label: string }[] = [
    { view: "list", href: listHref, label: t("list") },
    { view: "board", href: boardHref, label: t("board") },
  ];
  return (
    <div className="flex rounded-full border border-app-border bg-white p-[3px]">
      {items.map((item) => (
        <Link
          key={item.view}
          href={item.href}
          onClick={() => remember(item.view)}
          aria-current={item.view === current ? "page" : undefined}
          className={`rounded-full px-4 py-2 text-[13.5px] font-medium transition-colors ${
            item.view === current
              ? "bg-app-surface-nav text-cream"
              : "text-app-text-secondary hover:text-app-text-primary"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

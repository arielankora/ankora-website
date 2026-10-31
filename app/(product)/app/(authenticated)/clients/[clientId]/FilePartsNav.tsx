"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ALL_LABEL, FILE_SECTION_COOKIE, FILE_SECTIONS, sectionOfAnchor, type FileSection, type FileSectionKey } from "@/lib/client-file-parts";

// The index of the client file's parts (31.10.2026). On a wide screen a
// column beside the file, on a phone a row of chips above it. Choosing a
// part shows it alone and is remembered for the next visit; "הכול" is the
// long view as it was.

export type PartCount = { count: number | null; attention?: boolean };

function remember(s: FileSection) {
  document.cookie = `${FILE_SECTION_COOKIE}=${s}; path=/; max-age=31536000; samesite=lax`;
}

export function FilePartsNav({ base, current, counts }: { base: string; current: FileSection; counts: Partial<Record<FileSectionKey, PartCount>> }) {
  const router = useRouter();

  // A link that points at something in the file (#item-…, #processes)
  // arrives without knowing which part is open; when its target is not on
  // the page, open the part that holds it.
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (!anchor || current === "all" || document.getElementById(anchor)) return;
    const part = sectionOfAnchor(anchor);
    remember(part);
    router.replace(`${base}&section=${part}#${anchor}`);
  }, [base, current, router]);

  const items: { key: FileSection; label: string; count: number | null; attention?: boolean }[] = [
    { key: "all", label: ALL_LABEL, count: null },
    ...FILE_SECTIONS.map((s) => ({ key: s.key, label: s.label, count: counts[s.key]?.count ?? null, attention: counts[s.key]?.attention })),
  ];

  return (
    <nav aria-label="חלקי התיק" className="lg:sticky lg:top-4 lg:self-start" data-testid="file-parts-nav">
      <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:rounded-2xl lg:border lg:border-app-border lg:bg-white lg:p-2">
        {items.map((it) => {
          const on = it.key === current;
          return (
            <li key={it.key} className="shrink-0">
              <Link
                href={`${base}&section=${it.key}`}
                onClick={() => remember(it.key)}
                aria-current={on ? "page" : undefined}
                className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm lg:rounded-lg lg:py-2 ${
                  on ? "bg-app-surface-nav font-medium text-cream lg:bg-app-accent-soft lg:text-app-text-primary" : "border border-app-border bg-white text-app-text-secondary hover:text-app-text-primary lg:border-0 lg:bg-transparent"
                }`}
              >
                <span>{it.label}</span>
                {it.count !== null && (
                  <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${it.attention ? "bg-app-warning-soft font-medium text-app-warning" : on ? "" : "text-app-text-tertiary"}`}>{it.count}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

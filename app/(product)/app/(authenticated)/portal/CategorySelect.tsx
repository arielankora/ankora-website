"use client";

import { useRouter } from "next/navigation";

// 24.11.2026 (Hadas): one dropdown instead of a row of chips, which took
// four lines on a phone once a client had twelve categories.
export function CategorySelect({
  categories,
  active,
  allLabel,
  label,
}: {
  categories: Array<{ id: string; name: string }>;
  active: string | undefined;
  allLabel: string;
  label: string;
}) {
  const router = useRouter();
  return (
    <select
      aria-label={label}
      data-testid="portal-home-category-filter"
      value={active ?? ""}
      onChange={(e) =>
        router.push(e.target.value ? `/app/portal?category=${encodeURIComponent(e.target.value)}` : "/app/portal", { scroll: false })
      }
      className="w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold sm:w-auto"
    >
      <option value="">{allLabel}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

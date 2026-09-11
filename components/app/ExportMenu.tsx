"use client";
import { useState } from "react";
import { Download, ChevronDown } from "lucide-react";

// Redesign direction A: replaces 3 separately stacked "ייצוא ל-CSV /
// ל-Excel / ל-PDF" buttons/links (Time Entries, Reports, Client Portal
// monthly report - see docs/adr/0001 addendum) with one "ייצוא" button
// that opens a small menu. `baseHref` is the plain CSV export URL these
// screens already build (query params/filters baked in server- or
// client-side); Excel/PDF are the same URL with `&format=` appended, same
// as the old buttons did - no API route changes.
export function ExportMenu({ baseHref, primary = false }: { baseHref: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);

  const items = [
    { format: undefined, label: "CSV" },
    { format: "xlsx", label: "Excel" },
    { format: "pdf", label: "PDF" },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          primary
            ? "flex items-center gap-1.5 rounded-full bg-gold-gradient px-4 py-2 text-sm font-medium text-ink"
            : "flex items-center gap-1.5 rounded-full border border-lineDark px-4 py-2 text-sm font-medium text-navy transition-colors hover:border-gold"
        }
      >
        <Download size={15} strokeWidth={1.75} />
        ייצוא
        <ChevronDown size={14} strokeWidth={1.75} />
      </button>

      {open && (
        <>
          <button type="button" aria-label="סגירה" onClick={() => setOpen(false)} className="fixed inset-0 z-10" />
          <div
            role="menu"
            className="absolute end-0 z-20 mt-1.5 w-36 overflow-hidden rounded-lg border border-lineDark bg-white shadow-lg"
          >
            {items.map((item) => (
              <a
                key={item.label}
                href={item.format ? `${baseHref}&format=${item.format}` : baseHref}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm text-navy hover:bg-paper"
              >
                {item.label}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

"use client";
import { useRef, useTransition } from "react";
import { updateImportantDateStatusAction } from "./actions";
import type { ImportantDateStatus } from "@prisma/client";

const STATUS_OPTIONS: { value: ImportantDateStatus; label: string }[] = [
  { value: "ACTIVE", label: "פעיל" },
  { value: "NEEDS_ATTENTION", label: "דורש טיפול" },
  { value: "IN_PROGRESS", label: "בטיפול" },
  { value: "HANDLED_CURRENT", label: "טופל (מחזור נוכחי)" },
  { value: "PAUSED", label: "מושהה" },
  { value: "ARCHIVED", label: "בארכיון" },
];

/// Inline status-change control for one ImportantDate row - auto-submits
/// on selection, mirroring app/(product)/app/(authenticated)/tasks/
/// TaskStatusSelect.tsx exactly.
export function ImportantDateStatusSelect({ importantDateId, status }: { importantDateId: string; status: ImportantDateStatus }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form ref={formRef} action={(fd) => startTransition(() => updateImportantDateStatusAction(fd))}>
      <input type="hidden" name="importantDateId" value={importantDateId} />
      <select
        name="status"
        defaultValue={status}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-lineDark bg-white px-2 py-1 text-xs text-navy outline-none focus:border-gold disabled:opacity-50"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </form>
  );
}

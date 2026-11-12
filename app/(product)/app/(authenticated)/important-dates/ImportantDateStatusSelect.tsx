"use client";
import { useRef, useTransition } from "react";
import { useTranslations } from "next-intl";
import { updateImportantDateStatusAction } from "./actions";
import type { ImportantDateStatus } from "@prisma/client";

/// Their names are importantDates.status.<status> (ADR 0006).
const STATUS_OPTIONS: ImportantDateStatus[] = ["ACTIVE", "NEEDS_ATTENTION", "IN_PROGRESS", "HANDLED_CURRENT", "PAUSED", "ARCHIVED"];

/// Inline status-change control for one ImportantDate row - auto-submits
/// on selection, mirroring app/(product)/app/(authenticated)/tasks/
/// TaskStatusSelect.tsx exactly.
export function ImportantDateStatusSelect({ importantDateId, status }: { importantDateId: string; status: ImportantDateStatus }) {
  const t = useTranslations("importantDates.status");
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
        className="rounded-lg border border-app-border-strong bg-white px-2 py-1 text-xs text-app-text-primary outline-none focus:border-gold disabled:opacity-50"
      >
        {STATUS_OPTIONS.map((value) => (
          <option key={value} value={value}>
            {t(value)}
          </option>
        ))}
      </select>
    </form>
  );
}

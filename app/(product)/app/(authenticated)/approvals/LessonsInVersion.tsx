"use client";
import { useTranslations } from "next-intl";

// The lessons still open on a process, beside the button that approves a
// version of its procedure (19.11.2026). Approving never closes a lesson
// by itself: the approver ticks the ones the version covers, and those
// close as applied, "גרסה N". The rest stay open for the next version.

export type OpenLesson = { id: string; body: string; version: number | null };

export function LessonsInVersion({ lessons, version, checked, onChange }: { lessons: OpenLesson[]; version: number; checked: string[]; onChange: (ids: string[]) => void }) {
  const t = useTranslations("approvals.row.lessonsInVersion");
  if (lessons.length === 0) return null;
  const toggle = (id: string) => onChange(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]);
  return (
    <fieldset className="mt-2 rounded-lg border border-app-border bg-white px-3 py-2.5" data-testid="lessons-in-version">
      <legend className="px-1 text-[12.5px] font-medium text-app-text-primary">{t("title", { version: String(version) })}</legend>
      <ul className="mt-1 space-y-1.5">
        {lessons.map((l) => (
          <li key={l.id}>
            <label className="flex items-start gap-2 text-[12.5px] leading-relaxed text-app-text-primary">
              <input type="checkbox" className="mt-1 shrink-0" checked={checked.includes(l.id)} onChange={() => toggle(l.id)} data-testid="lesson-in-version" />
              <span className="min-w-0">
                <span dir="auto" className="whitespace-pre-line">{l.body}</span>
                {l.version !== null && <span className="text-app-text-tertiary"> ({t("fromVersion", { version: String(l.version) })})</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11.5px] text-app-text-tertiary">{t("rest")}</p>
    </fieldset>
  );
}

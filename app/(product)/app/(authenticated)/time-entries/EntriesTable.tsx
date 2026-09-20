"use client";
import { useMemo, useState } from "react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { bulkDeleteEntriesAction, bulkRestoreEntriesAction } from "./actions";
import { AdminEntryRow, type Entry } from "./AdminEntryRow";

// App redesign (handoff README, screen 9 "דיווחי זמן (אדמין)"): "בחירה
// מרובה: תיבת סימון בכל שורה; סרגל פעולות כהה (navy, radius 14px) מופיע רק
// כשיש בחירה, עם 'N דיווחים נבחרו', אישור קבוצתי (עם ביטול) וניקוי בחירה."
// This wraps the table so selection state lives above the per-row
// AdminEntryRow components; the primary bulk action is delete (see
// actions.ts's bulkDeleteEntriesAction comment for why, not "approve").
export function EntriesTable({ entries }: { entries: Entry[] }) {
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function bulkDelete() {
    const ids = selectedIds;
    if (ids.length === 0) return;
    setPending(true);
    const result = await bulkDeleteEntriesAction(ids);
    setPending(false);
    clearSelection();

    if (result.deleted.length > 0) {
      showToast({
        tone: result.failed.length > 0 ? "warning" : "success",
        title: `${result.deleted.length} דיווחים נמחקו`,
        description:
          result.failed.length > 0 ? `${result.failed.length} דיווחים לא נמחקו עקב הרשאה או חלון עריכה.` : undefined,
        undo: async () => {
          await bulkRestoreEntriesAction(result.deleted);
          showToast({ tone: "info", title: "המחיקה בוטלה", description: `${result.deleted.length} דיווחים שוחזרו.` });
        },
      });
    } else {
      showToast({ tone: "error", title: "המחיקה נכשלה", description: "לא ניתן היה למחוק את הדיווחים שנבחרו." });
    }
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-appNavy px-4 py-3 text-cream-warm">
          <span className="text-sm">{selected.size} דיווחים נבחרו</span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={pending}
            onClick={bulkDelete}
            className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-navy disabled:opacity-50"
          >
            מחיקת מסומנים
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-full border border-cream-warm/25 px-3.5 py-2 text-xs text-cream-warm/80"
          >
            ניקוי בחירה
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
        <table className="w-full min-w-[900px] text-start text-sm">
          <thead>
            <tr className="border-b border-lineDark text-xs text-appNavy/50">
              <th className="w-10 px-5 py-3"></th>
              <th className="px-5 py-3 font-medium">תאריך</th>
              <th className="px-5 py-3 font-medium">עובד</th>
              <th className="px-5 py-3 font-medium">לקוח</th>
              <th className="px-5 py-3 font-medium">קטגוריה</th>
              <th className="px-5 py-3 font-medium">משך</th>
              <th className="px-5 py-3 font-medium">הערה</th>
              <th className="px-5 py-3 font-medium">מקור</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-8 text-center text-appNavy/50">
                  אין דיווחים התואמים את הסינון.
                </td>
              </tr>
            )}
            {entries.map((entry) => (
              <AdminEntryRow
                key={entry.id}
                entry={entry}
                selected={selected.has(entry.id)}
                onToggleSelect={() => toggle(entry.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

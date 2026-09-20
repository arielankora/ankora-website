import Link from "next/link";
import { FileQuestion } from "lucide-react";

// App redesign (handoff README, "19. מצבי מסך"): generic 404 for any
// screen resolving a record by id (client, task, important date, ...).
export function NotFound({
  title = "הדף לא נמצא",
  description = "יכול להיות שהרשומה נמחקה או שהקישור שגוי.",
  backHref = "/app",
  backLabel = "חזרה לבית",
}: {
  title?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-lineDark bg-white px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-appNavy/5">
        <FileQuestion size={20} strokeWidth={1.75} className="text-appNavy/50" />
      </span>
      <p className="text-[15px] font-medium text-appNavy">{title}</p>
      <p className="max-w-sm text-sm text-appNavy/60">{description}</p>
      <Link href={backHref} className="mt-2 text-sm font-medium text-gold-dim hover:text-appNavy">
        {backLabel}
      </Link>
    </div>
  );
}

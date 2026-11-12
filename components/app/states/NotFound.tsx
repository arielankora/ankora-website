import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { useTranslations } from "next-intl";

// App redesign (handoff README, "19. מצבי מסך"): generic 404 for any
// screen resolving a record by id (client, task, important date, ...).
// Each text prop, when left out, falls back to the shared wording in the
// reader's language (shell.states.notFound).
export function NotFound({
  title,
  description,
  backHref = "/app",
  backLabel,
}: {
  title?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
}) {
  const t = useTranslations("shell.states.notFound");
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-app-border bg-white px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-app-surface-sunken">
        <FileQuestion size={20} strokeWidth={1.75} className="text-app-text-tertiary" />
      </span>
      <p className="text-[15px] font-medium text-app-text-primary">{title ?? t("title")}</p>
      <p className="max-w-sm text-sm text-app-text-secondary">{description ?? t("description")}</p>
      <Link href={backHref} className="mt-2 text-sm font-medium text-app-text-accent hover:text-app-text-primary">
        {backLabel ?? t("back")}
      </Link>
    </div>
  );
}

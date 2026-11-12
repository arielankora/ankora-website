import { useTranslations } from "next-intl";
import type { DuplicatePair } from "@/lib/name-match";

// Items that may be in the file twice under two spellings ("איילה" and
// "איילה מנצור"), and dates that fall on the same day under almost the
// same title: each name opens the item, where it is completed and the
// extra one removed. Nothing is merged on its own: a person decides.

/// The kinds a pair can be (clients.knowledge.duplicates.kinds).
const KINDS = ["CONTACT", "ORGANIZATION", "SYSTEM", "ENTITY", "DATE"] as const;

/// A date lives on its own page; everything else in the file, by anchor.
const hrefOf = (kind: string, id: string) => (kind === "DATE" ? `/app/important-dates/${id}` : `#item-${id}`);

export function PossibleDuplicates({ pairs }: { pairs: DuplicatePair[] }) {
  const t = useTranslations("clients.knowledge.duplicates");
  if (pairs.length === 0) return null;
  return (
    <section className="rounded-2xl border border-app-border bg-app-surface-card px-5 py-4" data-testid="possible-duplicates">
      <h2 className="text-sm font-medium text-app-text-primary">{t("heading", { count: pairs.length })}</h2>
      <p className="mt-0.5 text-xs text-app-text-tertiary">{t("intro")}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {pairs.map((p) => (
          <li key={`${p.a.id}-${p.b.id}`} className="text-app-text-secondary">
            <span className="text-xs text-app-text-tertiary">{(KINDS as readonly string[]).includes(p.kind) ? t(`kinds.${p.kind as (typeof KINDS)[number]}`) : p.kind}: </span>
            {t.rich("pair", {
              a: () => (
                <a href={hrefOf(p.kind, p.a.id)} className="text-app-text-accent hover:underline" dir="auto">
                  {p.a.name}
                </a>
              ),
              b: () => (
                <a href={hrefOf(p.kind, p.b.id)} className="text-app-text-accent hover:underline" dir="auto">
                  {p.b.name}
                </a>
              ),
            })}
            {p.match === "SAME" && <span className="ms-1.5 text-xs text-app-warning">{t("sameName")}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

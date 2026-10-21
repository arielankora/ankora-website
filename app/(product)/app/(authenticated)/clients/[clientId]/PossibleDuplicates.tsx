import type { DuplicatePair } from "@/lib/name-match";

// Items that may be in the file twice under two spellings ("איילה" and
// "איילה מנצור"), and dates that fall on the same day under almost the
// same title: each name opens the item, where it is completed and the
// extra one removed. Nothing is merged on its own: a person decides.

const KIND: Record<string, string> = {
  CONTACT: "אנשי קשר",
  ORGANIZATION: "ארגונים",
  SYSTEM: "מערכות",
  ENTITY: "ישויות",
  DATE: "מועדים",
};

/// A date lives on its own page; everything else in the file, by anchor.
const hrefOf = (kind: string, id: string) => (kind === "DATE" ? `/app/important-dates/${id}` : `#item-${id}`);

export function PossibleDuplicates({ pairs }: { pairs: DuplicatePair[] }) {
  if (pairs.length === 0) return null;
  return (
    <section className="rounded-2xl border border-app-border bg-app-surface-card px-5 py-4" data-testid="possible-duplicates">
      <h2 className="text-sm font-medium text-app-text-primary">כפילויות אפשריות ({pairs.length})</h2>
      <p className="mt-0.5 text-xs text-app-text-tertiary">אותו פריט אולי נכנס פעמיים בשם קצת אחר. משלימים את אחד מהם, ומסירים את השני.</p>
      <ul className="mt-2 space-y-1 text-sm">
        {pairs.map((p) => (
          <li key={`${p.a.id}-${p.b.id}`} className="text-app-text-secondary">
            <span className="text-xs text-app-text-tertiary">{KIND[p.kind] ?? p.kind}: </span>
            <a href={hrefOf(p.kind, p.a.id)} className="text-app-text-accent hover:underline">
              {p.a.name}
            </a>
            {" ו"}
            <a href={hrefOf(p.kind, p.b.id)} className="text-app-text-accent hover:underline">
              {p.b.name}
            </a>
            {p.match === "SAME" && <span className="ms-1.5 text-xs text-app-warning">אותו שם</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

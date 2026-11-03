import Link from "next/link";
import type { SubprocessorRecipient, SubprocessorRecipients } from "@/lib/app-domain/subprocessor-recipients";

// P8 step 8 (3.11.2026): who is told about a new sub-processor, and how.
// Collapsed by default: it matters a few times a year, on the day a
// sub-processor is added, and the clients screen is for every other day.

const dateFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" });

function Group({
  title,
  hint,
  clients,
  tone,
}: {
  title: string;
  hint: string;
  clients: SubprocessorRecipient[];
  tone: "email" | "warn" | "site";
}) {
  const toneClass = tone === "warn" ? "border-app-warning/35 bg-app-warning-soft" : "border-app-border bg-white";
  return (
    <section className={`rounded-xl border p-4 ${toneClass}`}>
      <h3 className="text-sm font-medium text-app-text-primary">
        {title} ({clients.length})
      </h3>
      <p className="mt-1 text-[11px] text-app-text-tertiary">{hint}</p>
      {clients.length === 0 ? (
        <p className="mt-3 text-xs text-app-text-secondary">אין לקוחות בקבוצה הזו.</p>
      ) : (
        <ul className="mt-3 divide-y divide-app-border">
            {clients.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <Link href={`/app/clients/${c.id}`} className="inline-flex min-h-11 items-center text-sm text-app-text-accent hover:underline">
                  {c.name}
                  {c.status === "PAUSED" ? " (מושהה)" : ""}
                </Link>
                {c.source ? (
                  <span className="text-[11px] text-app-text-tertiary">
                    {c.source}
                    {c.checkedAt ? `, נבדק ${dateFormat.format(c.checkedAt)}` : ""}
                  </span>
                ) : null}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

export function SubprocessorRecipientsPanel({ groups }: { groups: SubprocessorRecipients }) {
  return (
    <details className="rounded-2xl border border-app-border bg-white p-5">
      <summary className="cursor-pointer text-sm font-medium text-app-text-primary">
        נמענים להודעה על תת-מעבד חדש (P8 שלב 8)
      </summary>
      <p className="mt-2 text-xs text-app-text-secondary">
        לפי השדה &quot;התחייבות לעדכון יזום על תת-מעבד&quot; בכרטיס של כל לקוח. רק התחייבות מפורשת בחוזה נחשבת.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Group title="מקבלים מייל" hint="החוזה מחייב עדכון יזום." clients={groups.committed} tone="email" />
        <Group
          title="לא נבדק: מייל ליתר ביטחון"
          hint="עוד לא נבדק בחוזה. שולחים מייל, ומסמנים בכרטיס אחרי שבודקים."
          clients={groups.unchecked}
          tone="warn"
        />
        <Group title="מספיק עדכון באתר" hint="אין התחייבות בחוזה." clients={groups.notCommitted} tone="site" />
      </div>
    </details>
  );
}

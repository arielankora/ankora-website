import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalFile } from "@/lib/app-domain/client-file";
import { DOCUMENT_KIND_LABELS, SUPPLIER_EXPERIENCE_LABELS } from "@/lib/app-domain/portal-labels";
import { Forbidden } from "@/components/app/Forbidden";
import { PortalTabs } from "../PortalTabs";
import { PreferencesForm, DigestForm } from "./PreferencesForm";

export const metadata = { robots: { index: false, follow: false } };

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
}

function formatSize(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/// One shape for all four blocks, so the screen reads as one page rather
/// than as four features that happen to share a route.
function Block({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-lineDark bg-white">
      <div className="border-b border-lineDark px-[18px] py-3.5">
        <h2 className="text-[13.5px] font-medium text-appNavy">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-appNavy/55">{subtitle}</p>}
      </div>
      <div className="px-[18px] py-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-appNavy/50">{children}</p>;
}

// Portal phase 3, screen 5: "התיק שלי".
//
// A reference screen, not a feed. The client opens it rarely - when they
// are asked for a policy, when they want to remember who fixed the boiler
// last year, when something about how we work needs to change - so it is
// one page with everything on it rather than four places to look.
//
// The order is by how often someone comes here for it: preferences at the
// top because that is the part they change, then the people and the
// paperwork, then the dates that look after themselves.
export default async function PortalFilePage() {
  const user = await requireUser();

  let file;
  try {
    file = await getPortalFile(user);
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden />;
    throw err;
  }

  const { client, canEdit, preferences, digest, suppliers, documents, dates } = file;

  return (
    <div className="space-y-4">
      <PortalTabs active="file" />

      <div className="rounded-[20px] border border-gold/28 bg-[#FBF7F0] p-6 sm:p-7">
        <p className="text-xl font-medium text-appNavy">התיק של {client.name}</p>
        <p className="mt-1.5 text-[13.5px] text-appNavy/60">
          מה שאנחנו יודעים עליך ומה שנאסף תוך כדי עבודה. הכול כאן כדי שלא תצטרך לזכור את זה.
        </p>
      </div>

      <Block
        title="העדפות"
        subtitle={
          canEdit
            ? "מה שתכתוב כאן מגיע למנהל התיק שלך, ומשנה איך אנחנו עובדים."
            : "רק מנהל הלקוח יכול לשנות את זה."
        }
      >
        <PreferencesForm preferences={preferences} canEdit={canEdit} />
        {preferences.updatedAt && (
          <p className="mt-3 text-[11.5px] text-appNavy/45">עודכן לאחרונה ב-{formatDay(preferences.updatedAt)}</p>
        )}
      </Block>

      <Block title="כל כמה זמן לעדכן אותך" subtitle="לא נשלח יותר מזה, וגם לא פחות כשמשהו מחכה להחלטה שלך.">
        <DigestForm digest={digest} canEdit={canEdit} />
      </Block>

      <Block title="ספקים וגורמים" subtitle="מי טיפל במה, מתי, ואיך היה.">
        {suppliers.length === 0 ? (
          <Empty>עוד לא תיאמנו עבורך גורם חיצוני. כשנעשה זאת, הוא יירשם כאן.</Empty>
        ) : (
          <ul className="divide-y divide-lineDark/60">
            {suppliers.map((s) => (
              <li key={s.taskId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span className="text-sm text-appNavy">
                  {s.name}
                  <span className="text-appNavy/55"> · {s.what}</span>
                </span>
                <span className="flex items-center gap-2.5">
                  <span dir="ltr" className="font-jbmono text-[11.5px] text-appNavy/45">
                    {formatDay(s.when)}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      s.experience === "GOOD"
                        ? "border-success/25 bg-success-soft text-success"
                        : s.experience === "AVOID"
                          ? "border-error/25 bg-error-soft text-error"
                          : "border-lineDark bg-appNavy/5 text-appNavy/70"
                    }`}
                  >
                    {SUPPLIER_EXPERIENCE_LABELS[s.experience]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="מסמכים" subtitle="פוליסות, אישורים וחוזים שנוצרו תוך כדי העבודה עבורך.">
        {documents.length === 0 ? (
          <Empty>עוד אין מסמכים בתיק. כל מסמך שייווצר בעבודה עבורך יופיע כאן להורדה.</Empty>
        ) : (
          <ul className="divide-y divide-lineDark/60">
            {documents.map((d) => {
              const size = formatSize(d.sizeBytes);
              return (
                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <span className="text-sm text-appNavy">
                    {d.title}
                    <span className="text-appNavy/55"> · {DOCUMENT_KIND_LABELS[d.kind]}</span>
                  </span>
                  <span className="flex items-center gap-2.5">
                    {size && (
                      <span dir="ltr" className="font-jbmono text-[11.5px] text-appNavy/45">
                        {size}
                      </span>
                    )}
                    <span dir="ltr" className="font-jbmono text-[11.5px] text-appNavy/45">
                      {formatDay(d.addedAt)}
                    </span>
                    {/* A plain link, and the href is a document id rather
                        than a file: the server decides on every request
                        whether this person may have it. */}
                    <a href={`/api/portal/documents/${d.id}`} className="text-xs text-gold-dim hover:underline">
                      הורדה
                    </a>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block title="מועדים חוזרים" subtitle="חידושים, טיפולים ותשלומים שחוזרים כל שנה. אנחנו עוקבים אחריהם.">
        {dates.length === 0 ? (
          <Empty>עוד לא רשמנו מועד חוזר עבורך.</Empty>
        ) : (
          <ul className="divide-y divide-lineDark/60">
            {dates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span className="text-sm text-appNavy">{d.title}</span>
                {d.nextAt && (
                  <span dir="ltr" className="font-jbmono text-[11.5px] text-appNavy/45">
                    {formatDay(d.nextAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}

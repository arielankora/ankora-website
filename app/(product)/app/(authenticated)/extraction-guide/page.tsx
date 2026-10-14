import { requireUser } from "@/lib/app-auth/session";
import { canManageClients } from "@/lib/app-auth/permissions";
import { currentGuide, listGuideVersions } from "@/lib/app-domain/extraction-guide";
import { DEFAULT_EXTRACTION_GUIDE, guideLines } from "@/lib/extract-prompt";
import { DecideGuide, ProposeGuide } from "./GuideActions";

// Org brain, decision 3: "הנחיות החילוץ". The text every extraction prompt
// carries, in versions: anybody proposes, an admin approves.

export const metadata = { robots: { index: false, follow: false } };

const STATE_LABEL = { DRAFT: "ממתינה לאישור", APPROVED: "אושרה", REJECTED: "נדחתה" } as const;

function when(d: Date | null) {
  return d ? new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" }).format(d) : "";
}

export default async function ExtractionGuidePage() {
  const user = await requireUser();
  const [current, versions] = await Promise.all([currentGuide(), listGuideVersions(user)]);
  const body = current?.body ?? DEFAULT_EXTRACTION_GUIDE();
  const canDecide = canManageClients(user.role);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-medium text-appNavy">הנחיות החילוץ</h1>
        <p className="mt-1 text-sm text-appNavy/60">
          מה Claude מכניס לתיק הלקוח ומה לא. כל פרומט של &quot;חלץ ידע עם קלוד&quot; נושא את הגרסה המאושרת האחרונה. מה שהשרת אוכף נשאר בקוד ולא משתנה כאן.
        </p>
      </div>

      <section className="rounded-2xl border border-lineDark bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-appNavy">{current ? `בשימוש: גרסה ${current.version}` : "בשימוש: ההנחיות המקוריות"}</h2>
          <ProposeGuide current={body} />
        </div>
        <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-appNavy">
          {guideLines(body).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </section>

      {versions.length > 0 && (
        <section className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="text-sm font-medium text-appNavy">גרסאות</h2>
          <ul className="mt-3 divide-y divide-lineDark">
            {versions.map((v) => (
              <li key={v.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-appNavy">
                      גרסה {v.version} · {STATE_LABEL[v.state]}
                    </p>
                    <p className="text-xs text-appNavy/60">
                      {[v.createdByName ? `הוצעה על ידי ${v.createdByName}, ${when(v.createdAt)}` : when(v.createdAt), v.decidedByName ? `הוחלט על ידי ${v.decidedByName}` : null].filter(Boolean).join(" · ")}
                    </p>
                    {v.note && <p className="mt-1 text-xs text-appNavy/70">{v.note}</p>}
                    {v.rejectReason && <p className="mt-1 text-xs text-appNavy/60">למה נדחתה: {v.rejectReason}</p>}
                    {v.state === "DRAFT" && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs text-gold-dim">הטקסט המוצע</summary>
                        <ul className="mt-1.5 list-disc space-y-1 ps-5 text-xs text-appNavy/80">
                          {guideLines(v.body).map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  {v.state === "DRAFT" && canDecide && <DecideGuide id={v.id} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

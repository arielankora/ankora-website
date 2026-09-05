import { requireUser } from "@/lib/app-auth/session";
import { AppShell } from "@/components/app/AppShell";
import { GUIDE_GROUPS, ROLE_LABELS, type GuideRole } from "./content";

export const metadata = { robots: { index: false, follow: false } };

function RoleBadges({ roles }: { roles: GuideRole[] | "all" }) {
  if (roles === "all") {
    return (
      <span className="inline-flex items-center rounded-full bg-gold-gradient px-3 py-1 text-xs font-medium text-ink">
        כל המשתמשים
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <span key={role} className="inline-flex items-center rounded-full bg-navy/5 px-2.5 py-1 text-xs font-medium text-navy/70">
          {ROLE_LABELS[role]}
        </span>
      ))}
    </div>
  );
}

// Standing rule (docs/adr/0001): update the relevant entry in ./content.ts
// whenever a screen/capability is added or changed - this page itself
// only renders that data, it has no screen-specific text of its own.
export default async function GuidePage() {
  const user = await requireUser();

  return (
    <AppShell user={user}>
      <div className="space-y-10">
        <div>
          <h1 className="text-xl font-medium text-navy">מדריך שימוש</h1>
          <p className="mt-1 text-sm text-navy/60">
            הסבר מלא על כל יכולות המערכת - מה כל מסך עושה, מי יכול לגשת אליו, ואיך עובדים איתו.
          </p>
        </div>

        <nav aria-label="תוכן עניינים" className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="text-sm font-medium text-navy">תוכן העניינים</h2>
          <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {GUIDE_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="text-xs font-semibold uppercase tracking-wide text-gold-dim">{group.title}</p>
                <ul className="mt-1.5 space-y-1">
                  {group.sections.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`} className="text-sm text-navy/70 hover:text-navy hover:underline">
                        {section.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {GUIDE_GROUPS.map((group) => (
          <section key={group.id} className="space-y-6">
            <h2 className="text-lg font-medium text-navy">{group.title}</h2>
            {group.sections.map((section) => (
              <article
                key={section.id}
                id={section.id}
                className="scroll-mt-20 space-y-4 rounded-2xl border border-lineDark bg-white p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-base font-medium text-navy">{section.title}</h3>
                  <RoleBadges roles={section.roles} />
                </div>

                <p className="text-sm font-medium text-navy/80">{section.summary}</p>

                <div className="space-y-3">
                  {section.description.map((paragraph, i) => (
                    <p key={i} className="text-sm leading-relaxed text-navy/70">
                      {paragraph}
                    </p>
                  ))}
                </div>

                {section.steps && section.steps.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-navy/50">איך עושים את זה</p>
                    <ol className="mt-2 list-decimal space-y-1.5 pr-5 text-sm leading-relaxed text-navy/70">
                      {section.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {section.notes && section.notes.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-4">
                    {section.notes.map((note, i) => (
                      <p key={i} className="text-sm leading-relaxed text-navy/70">
                        {note}
                      </p>
                    ))}
                  </div>
                )}

                {section.images && section.images.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {section.images.map((image, i) => (
                      <figure key={i} className="overflow-hidden rounded-xl border border-lineDark">
                        {/* Static guide screenshots in public/guide - plain img is
                            intentional here (fixed, pre-sized assets, not user content). */}
                        <img src={image.src} alt={image.alt} className="w-full" />
                        <figcaption className="border-t border-lineDark bg-paperDim px-3 py-2 text-xs text-navy/50">
                          {image.caption}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>
        ))}
      </div>
    </AppShell>
  );
}

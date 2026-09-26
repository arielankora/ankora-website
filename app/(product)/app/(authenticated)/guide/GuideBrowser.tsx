"use client";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { ROLE_LABELS, type GuideGroup, type GuideRole } from "./content";
import { filterGuide, highlightParts, queryWords } from "./search";

// The table of contents and the sections, behind one search box.
//
// Client-side on purpose: the whole guide is already in the page, so
// filtering it needs no request and answers as the person types. The
// text stays server-rendered on first load; only the filtering is here.

function RoleBadges({ roles }: { roles: GuideRole[] | "all" }) {
  if (roles === "all") {
    return (
      <span className="inline-flex items-center rounded-full bg-gold-gradient px-3 py-1 text-xs font-medium text-navy">
        כל המשתמשים
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <span key={role} className="inline-flex items-center rounded-full bg-appNavy/5 px-2.5 py-1 text-xs font-medium text-appNavy/70">
          {ROLE_LABELS[role]}
        </span>
      ))}
    </div>
  );
}

function Hl({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {highlightParts(text, words).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-[3px] bg-gold/25 px-0.5 text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

export function GuideBrowser({ groups }: { groups: GuideGroup[] }) {
  const [query, setQuery] = useState("");
  const words = useMemo(() => queryWords(query), [query]);
  const shown = useMemo(() => filterGuide(groups, query), [groups, query]);
  const count = shown.reduce((n, g) => n + g.sections.length, 0);
  const GUIDE_GROUPS = shown;

  return (
    <>
      <div role="search" className="space-y-2">
        <label htmlFor="guide-search" className="sr-only">
          חיפוש במדריך
        </label>
        <div className="relative">
          <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-appNavy/40" />
          <input
            id="guide-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="חיפוש במדריך, למשל: מפקח, בנק שעות, ייצוא"
            className="w-full rounded-full border border-lineDark bg-white py-3 pe-11 ps-11 text-sm text-appNavy outline-none focus:border-gold [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="ניקוי החיפוש"
              className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-appNavy/40 hover:text-appNavy"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>
        {words.length > 0 && (
          <p aria-live="polite" className="text-[12.5px] text-appNavy/55">
            {count === 0 ? "לא נמצאו סעיפים. נסו מילה אחרת, או פחות מילים." : count === 1 ? "נמצא סעיף אחד" : `נמצאו ${count} סעיפים`}
          </p>
        )}
      </div>

{GUIDE_GROUPS.length > 0 && (
        <nav aria-label="תוכן עניינים" className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="text-sm font-medium text-appNavy">תוכן העניינים</h2>
          <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {GUIDE_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="text-xs font-semibold uppercase tracking-wide text-gold-dim">{group.title}</p>
                <ul className="mt-1.5 space-y-1">
                  {group.sections.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`} className="text-sm text-appNavy/70 hover:text-appNavy hover:underline">
                        <Hl text={section.title} words={words} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        )}

        {GUIDE_GROUPS.map((group) => (
          <section key={group.id} className="space-y-6">
            <h2 className="text-lg font-medium text-appNavy">{group.title}</h2>
            {group.sections.map((section) => (
              <article
                key={section.id}
                id={section.id}
                className="scroll-mt-20 space-y-4 rounded-2xl border border-lineDark bg-white p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-base font-medium text-appNavy">
                    <Hl text={section.title} words={words} />
                  </h3>
                  <RoleBadges roles={section.roles} />
                </div>

                <p className="text-sm font-medium text-appNavy/80">
                  <Hl text={section.summary} words={words} />
                </p>

                <div className="space-y-3">
                  {section.description.map((paragraph, i) => (
                    <p key={i} className="text-sm leading-relaxed text-appNavy/70">
                      <Hl text={paragraph} words={words} />
                    </p>
                  ))}
                </div>

                {section.steps && section.steps.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-appNavy/50">איך עושים את זה</p>
                    <ol className="mt-2 list-decimal space-y-1.5 pr-5 text-sm leading-relaxed text-appNavy/70">
                      {section.steps.map((step, i) => (
                        <li key={i}>
                          <Hl text={step} words={words} />
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {section.notes && section.notes.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-4">
                    {section.notes.map((note, i) => (
                      <p key={i} className="text-sm leading-relaxed text-appNavy/70">
                        <Hl text={note} words={words} />
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
                        <figcaption className="border-t border-lineDark bg-cream-dim px-3 py-2 text-xs text-appNavy/50">
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
    </>
  );
}

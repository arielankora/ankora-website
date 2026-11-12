import { getTranslations } from "next-intl/server";
import { PageBack } from "@/components/app/BackSlot";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { type DocItem } from "@/lib/client-file-document";
import { extractPromptFor } from "@/lib/app-domain/extract-prompt-input";
import { ExtractWithClaude } from "../ExtractWithClaude";
import { ControlLine } from "../ControlLine";

// Org brain, phase 2: the client file to read, top to bottom, in the order
// of Hadas's file (claude/org-brain-spec-2026-10-12.md, 6.1). The client
// screen is where the file is edited; this is where it is read, by anyone
// assigned to the client, and downloaded as Markdown or PDF.

export const metadata = { robots: { index: false, follow: false } };

/// ADR 0006: the screen's own words for each section, by its number. The
/// document (Markdown, PDF, Claude) keeps the titles it has always had.
const SECTION_KEYS = {
  "1": "identity",
  "2": "overview",
  "3": "people",
  "4": "preferences",
  "5": "requirements",
  "6": "rules",
  "7.1": "systems",
  "7.2": "vendors",
  "7.3": "locations",
  "7.4": "processes",
  "7.5": "requestTypes",
  "8": "finance",
  "9": "communication",
  "10": "dates",
  "11": "temporary",
  "12": "oneOff",
  "13": "questions",
  "14": "workRules",
  "": "notes",
  "15": "pending",
  "16": "changes",
} as const;
type SectionKey = (typeof SECTION_KEYS)[keyof typeof SECTION_KEYS];
const sectionKey = (n: string): SectionKey | null => (n in SECTION_KEYS ? SECTION_KEYS[n as keyof typeof SECTION_KEYS] : null);

async function Item({ item }: { item: DocItem }) {
  const t = await getTranslations("clients.file.read");
  const tStatus = await getTranslations("clients.page.knowledgeStatus");
  const details = (item.details ?? []).filter((d): d is string => !!d && !!d.trim());
  const weak = item.status === "UNCERTAIN" || item.status === "MISSING";
  return (
    <li dir="auto" className="py-1.5 text-sm leading-relaxed text-app-text-primary">
      {item.text}
      {details.length > 0 && <span className="text-app-text-secondary"> ({details.join(" · ")})</span>}
      {weak && (
        <span className={`ms-1.5 text-xs font-medium ${item.status === "MISSING" ? "text-app-error" : "text-app-warning"}`}>
          {tStatus(item.status!)}
          {item.toResolve ? `: ${item.toResolve}` : ""}
        </span>
      )}
      {item.doNotDisclose && <span className="ms-1.5 text-xs font-medium text-app-error">{t("doNotDisclose", { value: item.doNotDisclose })}</span>}
      {item.refs && item.refs.length > 0 && (
        <span className="ms-1.5 font-jbmono text-[11px] text-app-text-secondary" dir="ltr" data-testid="external-ref">
          {item.refs.join(", ")}
        </span>
      )}
      {item.sources && item.sources.length > 0 && (
        <span className="ms-1.5 text-[11px] text-app-text-tertiary" dir="ltr">
          [{item.sources.join(", ")}]
        </span>
      )}
    </li>
  );
}

export default async function ClientFilePage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const user = await requireUser();
  const t = await getTranslations("clients.file.read");
  const tControl = await getTranslations("clients.control");
  // The section keys are looked up by the section's number, so not
  // type-checked here; every number in SECTION_KEYS has both keys.
  const tSection = t as unknown as (key: string) => string;
  const sectionTitle = (s: { number: string; title: string }) => {
    const key = sectionKey(s.number);
    return key ? tSection(`sections.${key}.title`) : s.title;
  };
  const sectionEmpty = (s: { number: string; empty: string }) => {
    const key = sectionKey(s.number);
    return !s.empty ? "" : key ? tSection(`sections.${key}.empty`) : s.empty;
  };
  let doc;
  let extractPrompt: string | null;
  try {
    [doc, extractPrompt] = await Promise.all([buildClientFile(user, clientId, { audience: "staff" }), extractPromptFor(user, clientId)]);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <div>
        <PageBack href={`/app/clients/${clientId}`} label={doc.clientName} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-medium text-app-text-primary">{t("title", { name: doc.clientName })}</h1>
          <div className="flex items-center gap-4">
            <a href={`/api/clients/${clientId}/client-file?format=pdf`} className="text-sm text-app-text-accent hover:underline">
              {t("downloadPdf")}
            </a>
            <a href={`/api/clients/${clientId}/client-file`} className="text-sm text-app-text-accent hover:underline">
              {t("downloadMarkdown")}
            </a>
          </div>
        </div>
        {doc.control && (
          <div className="mt-2">
            <ControlLine parts={doc.controlMessages.map((m) => ({ text: tControl(`parts.${m.id}`, m.values), warn: m.warn, key: m.key }))} />
          </div>
        )}
        <p className="mt-2 text-xs leading-relaxed text-app-text-secondary">{t("howToRead")}</p>
        <div className="mt-3">
          {extractPrompt ? (
            <ExtractWithClaude prompt={extractPrompt} />
          ) : (
            <p className="text-xs text-app-text-secondary">{t("aiExcluded")}</p>
          )}
        </div>
      </div>

      {doc.sections.map((s) => {
        // An empty section is one quiet line (decision 7): the structure
        // stays the same for every client, and the file stays short. It is
        // still a heading, so the outline of the file never changes.
        if (s.items.length === 0) {
          return (
            <section key={`${s.number}-${s.title}`} className="flex flex-wrap items-baseline gap-x-2 px-6 text-sm">
              <h2 className="font-normal text-app-text-secondary">
                {s.number && <span className="me-2 font-mono text-app-text-accent">{s.number}</span>}
                {sectionTitle(s)}
              </h2>
              <p className="text-app-text-tertiary">{sectionEmpty(s)}</p>
            </section>
          );
        }
        const ungrouped = s.items.filter((i) => !i.group);
        const groups = [...new Set(s.items.filter((i) => i.group).map((i) => i.group!))];
        return (
          <section key={`${s.number}-${s.title}`} className="rounded-2xl border border-app-border bg-white p-6">
            <h2 className="text-sm font-medium text-app-text-primary">
              {s.number && <span className="me-2 font-mono text-app-text-accent">{s.number}</span>}
              {sectionTitle(s)}
            </h2>
            {ungrouped.length > 0 && (
              <ul className="mt-2 list-disc ps-5">
                {ungrouped.map((i, n) => (
                  <Item key={n} item={i} />
                ))}
              </ul>
            )}
            {groups.map((g) => (
              <div key={g} className="mt-3">
                <h3 className="text-xs font-medium text-app-text-secondary">{g}</h3>
                <ul className="mt-1 list-disc ps-5">
                  {s.items
                    .filter((i) => i.group === g)
                    .map((i, n) => (
                      <Item key={n} item={i} />
                    ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}

      <section className="rounded-2xl border border-app-border bg-white p-6">
        <h2 className="text-sm font-medium text-app-text-primary">{t("legend")}</h2>
        {doc.legend.length === 0 ? (
          <p className="mt-2 text-sm text-app-text-tertiary">{t("legendEmpty")}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {doc.legend.map((l) => (
              <li key={l.code} className="text-sm text-app-text-primary">
                <span className="me-2 font-mono text-app-text-accent" dir="ltr">
                  {l.code}
                </span>
                <span dir="auto">{l.title}</span>
                {l.details && <span className="text-app-text-secondary"> ({l.details})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

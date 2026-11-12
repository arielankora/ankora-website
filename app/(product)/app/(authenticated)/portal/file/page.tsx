import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { TIMEZONE } from "@/lib/timezone";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getPortalFile } from "@/lib/app-domain/client-file";
import { Forbidden } from "@/components/app/Forbidden";
import { CopyValue } from "@/components/app/CopyValue";
import { SITE_URL } from "@/lib/site";

/// The client portal connector (app/api/mcp/portal). Built from SITE_URL
/// for the same reason as the staff one in ClaudeConnectionCard: the OAuth
/// `resource` must match exactly what the person pastes.
const PORTAL_CONNECTOR_URL = `${SITE_URL}/api/mcp/portal`;
import { PreferencesForm, DigestForm } from "./PreferencesForm";

export const metadata = { robots: { index: false, follow: false } };

/// The groups lib/portal-knowledge.ts builds, by key (portal.file.knowledge.groups).
type KnowledgeGroupKey = "processes" | "rules" | "requests" | "systems" | "facts" | "people" | "entities";

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
    <section className="overflow-hidden rounded-2xl border border-app-border bg-white">
      <div className="border-b border-app-border px-[18px] py-3.5">
        <h2 className="text-[13.5px] font-medium text-app-text-primary">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-app-text-secondary">{subtitle}</p>}
      </div>
      <div className="px-[18px] py-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-app-text-tertiary">{children}</p>;
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

  const { client, canEdit, preferences, digest, suppliers, documents, dates, knowledge } = file;
  const t = await getTranslations("portal.file");
  const format = await getFormatter();
  // ADR 0006: in the reader's language. Days on this screen are Israeli
  // days (a renewal, a supplier visit), so they are written in Israel time.
  const formatDay = (date: Date) => format.dateTime(date, { day: "numeric", month: "short", year: "numeric", timeZone: TIMEZONE });
  const knowledgeDay = (date: Date) => format.dateTime(date, { day: "numeric", month: "numeric", year: "numeric", timeZone: TIMEZONE });
  // A tag code from lib/portal-knowledge.ts, under file.knowledge.tags. The
  // code is built from a status, so it is looked up without a type check;
  // portalKnowledge only sets codes for statuses that have a label.
  const tagText = (code: string) => (t as unknown as (key: string) => string)(`knowledge.tags.${code}`);

  return (
    <div className="space-y-4">

      <div className="rounded-[20px] border border-gold/28 bg-app-surface-sunken p-6 sm:p-7">
        <p className="text-xl font-medium text-app-text-primary">{t("title", { name: client.name })}</p>
        <p className="mt-1.5 text-[13.5px] text-app-text-secondary">
          {t("intro")}
        </p>
      </div>

      <Block
        title={t("preferencesTitle")}
        subtitle={canEdit ? t("preferencesCanEdit") : t("preferencesReadOnly")}
      >
        <PreferencesForm preferences={preferences} canEdit={canEdit} />
        {preferences.updatedAt && (
          <p className="mt-3 text-[11.5px] text-app-text-tertiary">{t("updatedOn", { date: formatDay(preferences.updatedAt) })}</p>
        )}
      </Block>

      <Block title={t("digestTitle")} subtitle={t("digestSubtitle")}>
        <DigestForm digest={digest} canEdit={canEdit} />
      </Block>

      {/* The client file, as far as it is the client's to see (lib/portal-knowledge.ts). */}
      {knowledge.map((g) => (
        <Block
          key={g.key}
          title={t(`knowledge.groups.${g.key as KnowledgeGroupKey}.title`)}
          subtitle={t(`knowledge.groups.${g.key as KnowledgeGroupKey}.subtitle`)}
        >
          <ul className="divide-y divide-app-border" data-testid={`portal-knowledge-${g.key}`}>
            {g.items.map((i, n) => {
              // What people wrote stays as written; the date beside it is
              // worded in the reader's language.
              const detail =
                [
                  i.detailText,
                  i.date ? t(i.date.kind === "next" ? "knowledge.next" : "knowledge.from", { date: knowledgeDay(i.date.at) }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || null;
              return (
              <li key={n} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span dir="auto" className="text-sm text-app-text-primary">
                  {i.text}
                  {detail && <span className="text-app-text-secondary"> · {detail}</span>}
                </span>
                <span className="flex items-center gap-2">
                  {i.askToConfirm && (
                    <span className="rounded-full border border-app-warning/30 bg-app-warning-soft px-2.5 py-1 text-[11px] text-app-warning">
                      {t("knowledge.askToConfirm")}
                    </span>
                  )}
                  {i.tagCode && (
                    <span className="rounded-full border border-app-border bg-app-surface-sunken px-2.5 py-1 text-[11px] text-app-text-secondary">
                      {tagText(i.tagCode)}
                    </span>
                  )}
                </span>
              </li>
              );
            })}
          </ul>
          {g.items.some((i) => i.askToConfirm) && (
            <p className="mt-3 text-[11.5px] text-app-text-tertiary">{t("knowledge.confirmNote")}</p>
          )}
        </Block>
      ))}

      <Block title={t("suppliersTitle")} subtitle={t("suppliersSubtitle")}>
        {suppliers.length === 0 ? (
          <Empty>{t("suppliersEmpty")}</Empty>
        ) : (
          <ul className="divide-y divide-app-border">
            {suppliers.map((s) => (
              <li key={s.taskId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span dir="auto" className="text-sm text-app-text-primary">
                  {s.name}
                  <span className="text-app-text-secondary"> · {s.what}</span>
                </span>
                <span className="flex items-center gap-2.5">
                  <span dir="ltr" className="font-jbmono text-[11.5px] text-app-text-tertiary">
                    {formatDay(s.when)}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      s.experience === "GOOD"
                        ? "border-app-success/25 bg-app-success-soft text-app-success"
                        : s.experience === "AVOID"
                          ? "border-app-error/25 bg-app-error-soft text-app-error"
                          : "border-app-border bg-app-surface-sunken text-app-text-secondary"
                    }`}
                  >
                    {t(`experience.${s.experience}`)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t("documentsTitle")} subtitle={t("documentsSubtitle")}>
        {documents.length === 0 ? (
          <Empty>{t("documentsEmpty")}</Empty>
        ) : (
          <ul className="divide-y divide-app-border">
            {documents.map((d) => {
              const size = formatSize(d.sizeBytes);
              return (
                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <span className="text-sm text-app-text-primary">
                    <bdi dir="auto">{d.title}</bdi>
                    <span className="text-app-text-secondary"> · {t(`documentKinds.${d.kind}`)}</span>
                  </span>
                  <span className="flex items-center gap-2.5">
                    {size && (
                      <span dir="ltr" className="font-jbmono text-[11.5px] text-app-text-tertiary">
                        {size}
                      </span>
                    )}
                    <span dir="ltr" className="font-jbmono text-[11.5px] text-app-text-tertiary">
                      {formatDay(d.addedAt)}
                    </span>
                    {/* A plain link, and the href is a document id rather
                        than a file: the server decides on every request
                        whether this person may have it. */}
                    <a href={`/api/portal/documents/${d.id}`} className="text-xs text-app-text-accent hover:underline">
                      {t("download")}
                    </a>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block title={t("datesTitle")} subtitle={t("datesSubtitle")}>
        {dates.length === 0 ? (
          <Empty>{t("datesEmpty")}</Empty>
        ) : (
          <ul className="divide-y divide-app-border">
            {dates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span dir="auto" className="text-sm text-app-text-primary">
                  {d.title}
                </span>
                {d.nextAt && (
                  <span dir="ltr" className="font-jbmono text-[11.5px] text-app-text-tertiary">
                    {formatDay(d.nextAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <div id="claude">
        <Block title={t("claude.title")} subtitle={t("claude.subtitle")}>
          <ol className="list-decimal space-y-1.5 pe-5 text-[13px] leading-relaxed text-app-text-secondary">
            <li>{t("claude.step1")}</li>
            <li>{t("claude.step2")}</li>
            <li>{t("claude.step3")}</li>
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code dir="ltr" className="rounded bg-app-surface-page px-2 py-1 font-jbmono text-[12px] text-app-text-primary">
              {PORTAL_CONNECTOR_URL}
            </code>
            <CopyValue value={PORTAL_CONNECTOR_URL} label={t("claude.copyLabel")} />
          </div>
          <p className="mt-3 text-[12px] text-app-text-secondary">
            {t("claude.note")}
          </p>
        </Block>
      </div>
    </div>
  );
}

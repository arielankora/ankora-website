import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { canManageClients } from "@/lib/app-auth/permissions";
import { currentGuide, listGuideVersions } from "@/lib/app-domain/extraction-guide";
import { DEFAULT_EXTRACTION_GUIDE, guideLines } from "@/lib/extract-prompt";
import { DecideGuide, ProposeGuide } from "./GuideActions";

// Org brain, decision 3: "הנחיות החילוץ". The text every extraction prompt
// carries, in versions: anybody proposes, an admin approves.

export const metadata = { robots: { index: false, follow: false } };

// ADR 0006: the guidance itself (the current text and every version's
// text) is what each extraction prompt carries to Claude. It is content
// and stays as written; only the screen around it is translated.

export default async function ExtractionGuidePage() {
  const user = await requireUser();
  const [current, versions] = await Promise.all([currentGuide(), listGuideVersions(user)]);
  const body = current?.body ?? DEFAULT_EXTRACTION_GUIDE();
  const canDecide = canManageClients(user.role);
  const t = await getTranslations("extractionGuide");
  const format = await getFormatter();
  const when = (d: Date | null) => (d ? format.dateTime(d, { day: "numeric", month: "numeric", year: "numeric" }) : "");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
        <p className="mt-1 text-sm text-app-text-secondary">
          {t("intro")}
        </p>
      </div>

      <section className="rounded-2xl border border-app-border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-app-text-primary">{current ? t("inUseVersion", { version: String(current.version) }) : t("inUseOriginal")}</h2>
          <ProposeGuide current={body} />
        </div>
        <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-app-text-primary">
          {guideLines(body).map((l, i) => (
            <li key={i} dir="auto">{l}</li>
          ))}
        </ul>
      </section>

      {versions.length > 0 && (
        <section className="rounded-2xl border border-app-border bg-white p-6">
          <h2 className="text-sm font-medium text-app-text-primary">{t("versions")}</h2>
          <ul className="mt-3 divide-y divide-app-border">
            {versions.map((v) => (
              <li key={v.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-app-text-primary">
                      {t("versionLine", { version: String(v.version), state: t(`states.${v.state}`) })}
                    </p>
                    <p className="text-xs text-app-text-secondary">
                      {[v.createdByName ? t("proposedBy", { name: v.createdByName, date: when(v.createdAt) }) : when(v.createdAt), v.decidedByName ? t("decidedBy", { name: v.decidedByName }) : null].filter(Boolean).join(" · ")}
                    </p>
                    {v.note && <p dir="auto" className="mt-1 text-xs text-app-text-secondary">{v.note}</p>}
                    {v.rejectReason && <p className="mt-1 text-xs text-app-text-secondary">{t("rejectReason", { reason: v.rejectReason })}</p>}
                    {v.state === "DRAFT" && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs text-app-text-accent">{t("proposedText")}</summary>
                        <ul className="mt-1.5 list-disc space-y-1 ps-5 text-xs text-app-text-primary">
                          {guideLines(v.body).map((l, i) => (
                            <li key={i} dir="auto">{l}</li>
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

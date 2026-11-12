"use client";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useFormatter } from "next-intl";
import { credentialExposureReportAction, type ExposureReportView } from "../actions";

// "גישות שנצפו": the DPA section 4 report, on the page of the person who
// is leaving. One button, then one block per client with the list and the
// message to send them. Nothing is sent from here.

const DATE = { day: "numeric", month: "numeric", year: "numeric" } as const;

export function ExposureReport({ userId }: { userId: string }) {
  const t = useTranslations("users.exposure");
  const format = useFormatter();
  const [report, setReport] = useState<ExposureReportView | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setReport(await credentialExposureReportAction(userId)))}
        className="rounded-full border border-app-border px-4 py-2 text-xs font-medium text-app-text-secondary hover:border-gold hover:text-app-text-primary disabled:opacity-50"
      >
        {pending ? t("generating") : t("generate")}
      </button>

      {report && !report.ok && <p className="mt-3 text-sm text-app-error">{report.error}</p>}

      {report?.ok && (
        <div className="mt-4 space-y-4" data-exposure-report>
          <p className="text-xs text-app-text-secondary">
            {t("period", { since: format.dateTime(new Date(report.since), DATE), until: format.dateTime(new Date(report.until), DATE) })}
          </p>
          {report.clients.length === 0 ? (
            <p className="text-sm text-app-text-secondary">{t("none", { name: report.userName })}</p>
          ) : (
            report.clients.map((c) => <ClientBlock key={c.clientId} client={c} />)
          )}
        </div>
      )}
    </div>
  );
}

function ClientBlock({ client }: { client: Extract<ExposureReportView, { ok: true }>["clients"][number] }) {
  const t = useTranslations("users.exposure");
  const format = useFormatter();
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-app-border p-4">
      <p dir="auto" className="text-sm font-medium text-app-text-primary">{client.clientName}</p>
      <ul className="mt-2 space-y-1 text-sm text-app-text-primary">
        {client.items.map((i) => (
          <li key={i.credentialId}>
            <bdi>{i.systemName}</bdi>
            <span className="text-xs text-app-text-tertiary">
              {" "}
              · {t("views", { count: i.revealCount })} · {t("lastView", { date: format.dateTime(new Date(i.lastRevealedAt), DATE) })}
              {i.deleted ? ` · ${t("deletedSince")}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-app-text-secondary">{t("messageToClient")}</summary>
        <textarea
          readOnly
          value={client.message}
          rows={Math.min(14, client.message.split("\n").length + 1)}
          className="mt-2 w-full rounded-lg border border-app-border-strong bg-cream-dim p-3 text-sm text-app-text-primary"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(client.message);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // The text above is selectable.
            }
          }}
          className="mt-2 text-xs font-medium text-app-text-secondary hover:text-app-text-primary"
        >
          {copied ? t("copied") : t("copy")}
        </button>
      </details>
    </div>
  );
}

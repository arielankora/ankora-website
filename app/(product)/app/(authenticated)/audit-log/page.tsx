import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { parsePageNumber } from "@/lib/url-numbers";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { getFormatter, getTranslations } from "next-intl/server";
import { ENTITY_TYPES, actionMessageKey, auditSearchWhere, classifyAction } from "./labels";

export const metadata = { robots: { index: false, follow: false } };

const PAGE_SIZE = 50;

export default async function AuditLogPage(
  props: {
    searchParams: Promise<{ entityType?: string; q?: string; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await requireUser();

  if (!can(user.role, "audit.view")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const entityType = searchParams.entityType && ENTITY_TYPES.includes(searchParams.entityType) ? searchParams.entityType : undefined;
  const q = searchParams.q?.trim();
  // Parsed, not coerced. `Math.max(1, Number(raw) || 1)` lets `?page=1.001`
  // and `?page=1e999` through, and both reach Prisma as a `skip` that is not
  // a whole number, which is a 500 on this screen. See lib/url-numbers.ts.
  const page = parsePageNumber(searchParams.page);

  const where = {
    ...(entityType ? { entityType } : {}),
    ...(q ? auditSearchWhere(q) : {}),
  };

  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      include: { actor: true, client: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const t = await getTranslations("auditLog");
  const format = await getFormatter();
  // An action with no label renders as its raw key, as it always has
  // (tests/unit/audit-labels.test.ts keeps that from happening).
  const actionLabel = (action: string) => {
    const key = `actions.${actionMessageKey(action)}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : action;
  };

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
          <p className="mt-1 text-sm text-app-text-secondary">{t("subtitle")}</p>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-4 rounded-2xl border border-app-border bg-white p-4">
          <div>
            <label className="block text-xs font-medium text-app-text-secondary">{t("filter.entityType")}</label>
            <select
              name="entityType"
              defaultValue={entityType ?? ""}
              className="mt-1.5 rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            >
              <option value="">{t("filter.all")}</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-app-text-secondary">{t("filter.search")}</label>
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder={t("filter.searchPlaceholder")}
              className="mt-1.5 w-64 max-w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </div>
          <button type="submit" className="rounded-full border border-app-border px-4 py-2 text-sm text-app-text-secondary hover:border-gold">
            {t("filter.submit")}
          </button>
          <a
            href={`/api/audit-log/export${entityType || q ? `?${new URLSearchParams({ ...(entityType ? { entityType } : {}), ...(q ? { q } : {}) }).toString()}` : ""}`}
            className="ms-auto rounded-full border border-app-border px-4 py-2 text-sm text-app-text-secondary transition-colors hover:border-gold"
          >
            {t("filter.export")}
          </a>
        </form>

        <div className="overflow-x-auto rounded-2xl border border-app-border bg-white">
          <table className="w-full min-w-[820px] text-start text-sm">
            <thead>
              <tr className="border-b border-app-border text-xs text-app-text-tertiary">
                <th className="px-5 py-3 font-medium">{t("table.kind")}</th>
                <th className="px-5 py-3 font-medium">{t("table.action")}</th>
                <th className="px-5 py-3 font-medium">{t("table.actor")}</th>
                <th className="px-5 py-3 font-medium">{t("table.client")}</th>
                <th className="px-5 py-3 font-medium">{t("table.when")}</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-app-text-tertiary">
                    {t("table.empty")}
                  </td>
                </tr>
              )}
              {events.map((event) => {
                const kind = classifyAction(event.action);
                return (
                  <tr key={event.id} className="border-b border-app-border last:border-0 align-top">
                    <td className="whitespace-nowrap px-5 py-3">
                      <StatusBadge label={t(`kinds.${kind.kind}`)} tone={kind.tone} />
                    </td>
                    <td className="px-5 py-3 text-app-text-primary">
                      {actionLabel(event.action)}
                      <p className="mt-0.5 text-xs text-app-text-tertiary">
                        {event.entityType}
                        {event.entityId && ` #${event.entityId.slice(-6)}`}
                      </p>
                    </td>
                    <td dir={event.actor ? "auto" : undefined} className="px-5 py-3 text-app-text-secondary">{event.actor?.name ?? t("table.system")}</td>
                    <td dir={event.client ? "auto" : undefined} className="px-5 py-3 text-app-text-secondary">{event.client?.name ?? "-"}</td>
                    <td dir="ltr" className="whitespace-nowrap px-5 py-3 text-end font-jbmono text-xs text-app-text-tertiary">
                      {format.dateTime(event.createdAt, { dateStyle: "short", timeStyle: "short" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 text-sm text-app-text-secondary">
            {page > 1 && (
              <Link
                href={{ pathname: "/app/audit-log", query: { entityType, q, page: page - 1 } }}
                className="rounded-full border border-app-border px-3 py-1.5 hover:border-gold"
              >
                {t("pagination.previous")}
              </Link>
            )}
            <span>{t("pagination.page", { page: String(page), total: String(totalPages) })}</span>
            {page < totalPages && (
              <Link
                href={{ pathname: "/app/audit-log", query: { entityType, q, page: page + 1 } }}
                className="rounded-full border border-app-border px-3 py-1.5 hover:border-gold"
              >
                {t("pagination.next")}
              </Link>
            )}
          </div>
        )}

        <p className="text-xs text-app-text-tertiary">{t("retention")}</p>
      </div>
    </>
  );
}

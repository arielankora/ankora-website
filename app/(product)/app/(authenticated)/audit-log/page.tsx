import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { parsePageNumber } from "@/lib/url-numbers";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ACTION_LABEL, ENTITY_TYPES, auditSearchWhere, classifyAction } from "./labels";

export const metadata = { robots: { index: false, follow: false } };

const PAGE_SIZE = 50;
function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(date);
}

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

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">יומן פעולות</h1>
          <p className="mt-1 text-sm text-app-text-secondary">רשומה בלתי ניתנת לעריכה של כל הפעולות הרגישות במערכת.</p>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-4 rounded-2xl border border-app-border bg-white p-4">
          <div>
            <label className="block text-xs font-medium text-app-text-secondary">סוג ישות</label>
            <select
              name="entityType"
              defaultValue={entityType ?? ""}
              className="mt-1.5 rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            >
              <option value="">הכל</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-app-text-secondary">חיפוש</label>
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="פעולה, שם, לקוח או מזהה"
              className="mt-1.5 w-64 max-w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </div>
          <button type="submit" className="rounded-full border border-app-border px-4 py-2 text-sm text-app-text-secondary hover:border-gold">
            סינון
          </button>
          <a
            href={`/api/audit-log/export${entityType || q ? `?${new URLSearchParams({ ...(entityType ? { entityType } : {}), ...(q ? { q } : {}) }).toString()}` : ""}`}
            className="ms-auto rounded-full border border-app-border px-4 py-2 text-sm text-app-text-secondary transition-colors hover:border-gold"
          >
            ייצוא
          </a>
        </form>

        <div className="overflow-x-auto rounded-2xl border border-app-border bg-white">
          <table className="w-full min-w-[820px] text-start text-sm">
            <thead>
              <tr className="border-b border-app-border text-xs text-app-text-tertiary">
                <th className="px-5 py-3 font-medium">סוג</th>
                <th className="px-5 py-3 font-medium">פעולה</th>
                <th className="px-5 py-3 font-medium">בוצע ע&quot;י</th>
                <th className="px-5 py-3 font-medium">לקוח</th>
                <th className="px-5 py-3 font-medium">מועד</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-app-text-tertiary">
                    לא נמצאו רשומות התואמות לסינון.
                  </td>
                </tr>
              )}
              {events.map((event) => {
                const kind = classifyAction(event.action);
                return (
                  <tr key={event.id} className="border-b border-app-border last:border-0 align-top">
                    <td className="whitespace-nowrap px-5 py-3">
                      <StatusBadge label={kind.label} tone={kind.tone} />
                    </td>
                    <td className="px-5 py-3 text-app-text-primary">
                      {ACTION_LABEL[event.action] ?? event.action}
                      <p className="mt-0.5 text-xs text-app-text-tertiary">
                        {event.entityType}
                        {event.entityId && ` #${event.entityId.slice(-6)}`}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-app-text-secondary">{event.actor?.name ?? "מערכת"}</td>
                    <td className="px-5 py-3 text-app-text-secondary">{event.client?.name ?? "-"}</td>
                    <td dir="ltr" className="whitespace-nowrap px-5 py-3 text-end font-jbmono text-xs text-app-text-tertiary">
                      {formatDateTime(event.createdAt)}
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
                הקודם
              </Link>
            )}
            <span>
              עמוד {page} מתוך {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={{ pathname: "/app/audit-log", query: { entityType, q, page: page + 1 } }}
                className="rounded-full border border-app-border px-3 py-1.5 hover:border-gold"
              >
                הבא
              </Link>
            )}
          </div>
        )}

        <p className="text-xs text-app-text-tertiary">היומן נשמר לשנתיים ואינו ניתן לעריכה או למחיקה.</p>
      </div>
    </>
  );
}

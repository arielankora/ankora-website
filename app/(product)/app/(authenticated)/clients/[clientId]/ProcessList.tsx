"use client";

// The client's processes as one list (13.11.2026, processes redesign,
// stage 2). Built to the "מסך 1: רשימת התהליכים" board
// (ops-runbooks/processes-redesign-design/List.dc.html in claude-backup):
// what needs attention on top, one row a process with its rhythm in words,
// and the work instructions under it. Each row opens the process's page.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { CenterDialog } from "@/components/app/Drawer";
import { describeRhythm } from "@/lib/process-rhythm";
import { runBlockerKey } from "@/lib/process-readiness";
import { ProcessForm, type FormOptions, type PanelProcess } from "./ProcessesPanel";

type Tx = (key: string, values?: Record<string, string | number>) => string;
type Filter = "all" | "active" | "draft" | "paused" | "mine";

export function processHref(clientId: string, processId: string) {
  return `/app/clients/${clientId}/processes/${processId}`;
}

const PILL: Record<string, string> = {
  ACTIVE: "bg-app-success-soft text-app-success",
  DRAFT: "bg-app-info-soft text-app-info",
  PAUSED: "bg-app-neutral-soft text-app-text-secondary",
};

export function ProcessList({ clientId, userId, processes, form }: { clientId: string; userId: string; processes: PanelProcess[]; form: FormOptions }) {
  const t = useTranslations("clients.processes.list") as unknown as Tx;
  const tp = useTranslations("clients.processes") as unknown as Tx;
  const lang = useLocale().startsWith("en") ? "en" : "he";
  const format = useFormatter();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const staffName = useMemo(() => new Map(form.staff.map((s) => [s.id, s.name])), [form.staff]);

  const runs = processes.filter((p) => p.kind !== "GUIDE");
  const guides = processes.filter((p) => p.kind === "GUIDE");
  const day = (iso: string) => format.dateTime(new Date(iso), { weekday: "long", day: "numeric", month: "numeric" });
  const short = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "numeric" });
  const today = new Date().toISOString().slice(0, 10);

  // What needs a person: a reason it will not run, a draft waiting for
  // approval, or a run that is past its day and still open.
  const attention = runs.flatMap((p) => {
    const open = p.runs.find((r) => r.status !== "DONE" && r.status !== "ARCHIVED");
    const key = runBlockerKey(p.readiness?.blocker);
    if (p.readiness && !p.readiness.ready && p.status !== "PAUSED" && p.status !== "DRAFT")
      return [{ p, reason: key ? tp(`readiness.blockers.${key}`) : (p.readiness.blocker ?? ""), action: t("toProcess"), href: processHref(clientId, p.id) }];
    if (p.draft?.mayApprove) return [{ p, reason: t("draftWaits", { version: p.draft.version }), action: t("toApprove"), href: processHref(clientId, p.id) }];
    if (open && open.dueDate && open.dueDate.slice(0, 10) < today)
      return [{ p, reason: open.waitingOn ? t("runWaits", { date: short(open.dueDate), step: open.waitingOn }) : t("runOpen", { date: short(open.dueDate) }), action: t("toRun"), href: `/app/tasks/${open.id}` }];
    return [];
  });

  const counts = { all: runs.length, active: runs.filter((p) => p.status === "ACTIVE").length, draft: runs.filter((p) => p.status === "DRAFT").length, paused: runs.filter((p) => p.status === "PAUSED").length };
  const shown = runs.filter((p) => (filter === "all" ? true : filter === "active" ? p.status === "ACTIVE" : filter === "draft" ? p.status === "DRAFT" : filter === "paused" ? p.status === "PAUSED" : p.ownerId === userId));

  const nextOf = (p: PanelProcess) => {
    if (p.nextDate) return day(p.nextDate);
    if (p.status === "PAUSED") return t("paused");
    const k = p.triggerKinds;
    if (k.includes("EXTERNAL")) return t("next.external");
    // The board: an ongoing process's next is its check, "בדיקה ראשון 15.11".
    if (k.includes("CONTINUOUS")) return p.checkDue ? t("next.check", { date: day(`${p.checkDue.key}T12:00:00Z`) }) : t("next.continuous");
    if (k.includes("EVENT")) return t("next.event");
    if (k.includes("ON_DEMAND")) return t("next.onDemand");
    return "";
  };
  const lastOf = (p: PanelProcess) => {
    // The board: an ongoing process's last is its check, "נבדק 8.11, תקין".
    const c = p.triggerKinds.includes("CONTINUOUS") ? p.checks[0] : undefined;
    if (c) return t(c.outcome === "OK" ? "last.checkedOk" : "last.checkedIssue", { date: short(c.createdAt) });
    const r = p.runs[0];
    if (!r) return t("last.never");
    if (r.status === "DONE" || r.status === "ARCHIVED") return r.dueDate ? t("last.done", { date: short(r.dueDate) }) : t("last.doneNoDate");
    if (r.stepsTotal) return t("last.open", { done: r.stepsDone ?? 0, total: r.stepsTotal });
    return t("last.openPlain");
  };
  const chip = (on: boolean) => `min-h-[38px] rounded-full px-4 text-sm ${on ? "bg-app-surface-nav font-bold text-white" : "border border-app-border bg-white text-app-text-primary"}`;

  return (
    <div id="processes" className="flex flex-col gap-6" data-testid="process-list">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[28px] font-extrabold text-app-text-primary">{t("title")}</h2>
          <p className="text-sm text-app-text-secondary">
            {[
              t("summary.total", { count: runs.length }),
              t("summary.running", { count: runs.filter((p) => p.readiness?.ready && p.status === "ACTIVE").length }),
              attention.length ? t("summary.attention", { count: attention.length }) : null,
              counts.draft ? t("summary.drafts", { count: counts.draft }) : null,
              guides.length ? t("summary.guides", { count: guides.length }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`/app/clients/${clientId}/procedures`} className="inline-flex min-h-[44px] items-center rounded-[10px] border border-app-border-strong bg-white px-4 text-sm font-medium text-app-text-primary">
            {t("documents")}
          </Link>
          <CenterDialog triggerLabel={t("new")} triggerVariant="primary" title={t("newTitle")}>
            <div className="px-5 py-6 sm:px-8">
              <ProcessForm clientId={clientId} {...form} only={["what", "who"]} withSources onCreated={(id) => router.push(`${processHref(clientId, id)}?rhythm=open`)} />
            </div>
          </CenterDialog>
        </div>
      </div>

      {attention.length > 0 && (
        <section className="flex flex-col gap-3 rounded-[14px] bg-app-warning-soft px-5 py-4" data-testid="process-attention">
          <h3 className="text-base font-bold text-app-warning">{t("attention")}</h3>
          {attention.map(({ p, reason, action, href }) => (
            <div key={p.id} className="grid items-center gap-x-4 gap-y-1 rounded-[10px] bg-white px-4 py-3 sm:grid-cols-[70px_minmax(0,220px)_minmax(0,1fr)_auto]">
              <span className="font-bold text-app-text-accent">{p.code}</span>
              <span className="font-bold text-app-text-primary">{p.title}</span>
              <span className="text-sm text-app-text-secondary">{reason}</span>
              <Link href={href} className="inline-flex min-h-[40px] items-center justify-center rounded-[9px] border border-app-warning px-4 text-sm font-bold text-app-warning">
                {action}
              </Link>
            </div>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("filterLabel")}>
        {(
          [
            ["all", t("filters.all", { count: counts.all })],
            ["active", t("filters.active", { count: counts.active })],
            ["draft", t("filters.draft", { count: counts.draft })],
            ["paused", t("filters.paused", { count: counts.paused })],
            ["mine", t("filters.mine")],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={chip(filter === f)}>
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-app-border bg-white">
        <table className="w-full min-w-[720px] text-start text-[15px]">
          <thead>
            <tr className="bg-app-surface-sunken text-[13px] font-bold text-app-text-secondary">
              <th className="w-[70px] px-5 py-3.5 text-start">{t("cols.code")}</th>
              <th className="px-3 py-3.5 text-start">{t("cols.process")}</th>
              <th className="px-3 py-3.5 text-start">{t("cols.rhythm")}</th>
              <th className="px-3 py-3.5 text-start">{t("cols.owner")}</th>
              <th className="px-3 py-3.5 text-start">{t("cols.next")}</th>
              <th className="px-3 py-3.5 text-start">{t("cols.last")}</th>
              <th className="px-5 py-3.5 text-start">{t("cols.status")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} id={`item-${p.id}`} className="border-t border-app-border align-middle" data-testid={`process-row-${p.code}`}>
                <td className="px-5 py-3.5 font-bold text-app-text-accent">{p.code}</td>
                <td className="px-3 py-3.5">
                  <Link href={processHref(clientId, p.id)} className="font-bold text-app-text-primary hover:underline">
                    {p.title}
                  </Link>
                </td>
                <td className="px-3 py-3.5">
                  <span className="inline-block rounded-lg bg-app-neutral-soft px-2.5 py-1 text-sm text-app-text-primary">
                    {p.rhythmStarts?.length ? describeRhythm(p.rhythmStarts, p.rhythmDates ?? [], lang) : t("noRhythm")}
                  </span>
                </td>
                <td className="px-3 py-3.5 text-app-text-secondary">{p.ownerId ? staffName.get(p.ownerId) ?? "" : t("noOwner")}</td>
                <td className="px-3 py-3.5 text-app-text-secondary">{nextOf(p)}</td>
                <td className="px-3 py-3.5 text-app-text-secondary">{lastOf(p)}</td>
                <td className="px-5 py-3.5">
                  <span className={`inline-block rounded-full px-2.5 py-1 text-[13px] font-bold ${PILL[p.status] ?? PILL.PAUSED}`}>{tp(`labels.statuses.${p.status}`)}</span>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-6 text-center text-sm text-app-text-secondary">
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {guides.length > 0 && (
        <section className="mt-3 flex flex-col gap-3.5" data-testid="process-guides">
          <div className="flex flex-wrap items-baseline gap-3.5">
            <h3 className="text-2xl font-extrabold text-app-text-primary">{t("guides")}</h3>
            <span className="text-[15px] text-app-text-secondary">{t("guidesHint")}</span>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {guides.map((g) => (
              <Link key={g.id} href={processHref(clientId, g.id)} className="flex flex-col gap-1.5 rounded-xl border border-app-border bg-white px-4 py-4 text-app-text-primary">
                <span className="flex items-baseline gap-2.5">
                  <span className="font-bold text-app-text-accent">{g.code}</span>
                  <span className="text-base font-bold">{g.title}</span>
                </span>
                <span className="text-sm text-app-text-secondary">
                  {[g.ownerId ? staffName.get(g.ownerId) : null, g.current ? t("version", { version: g.current.version }) : t("noProcedure")].filter(Boolean).join(" · ")}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

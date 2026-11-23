import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { can, canManageClients } from "@/lib/app-auth/permissions";
import { Forbidden } from "@/components/app/Forbidden";
import { listSharedBlocks } from "@/lib/app-domain/agent-library";
import { diffLines } from "@/lib/agents/diff";
import { BLOCK_KINDS } from "@/lib/agents/model";
import { DecideShared, EditShared } from "../AgentForms";

// Agents, phase 3: "ספריית קטעים". A rule many agents share is written here
// once; approving its new version writes it into every agent that uses it.

export const metadata = { robots: { index: false, follow: false } };

export default async function LibraryPage() {
  const user = await requireUser();
  if (!can(user.role, "time_entry.create_self")) return <Forbidden />;
  const blocks = await listSharedBlocks(user);
  const manager = canManageClients(user.role);
  const format = await getFormatter();
  const t = await getTranslations("agents.library");
  const tl = await getTranslations("agents.labels");
  const kindLabel = (k: string) => ((BLOCK_KINDS as readonly string[]).includes(k) ? tl(`blockKind.${k as (typeof BLOCK_KINDS)[number]}`) : k);
  const when = (d: Date | null) => (d ? format.dateTime(d, { day: "numeric", month: "numeric" }) : "");

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="text-[13px] text-app-text-secondary">
        <Link href="/app/agents" className="hover:underline">{t("crumb")}</Link> / {t("title")}
      </div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-app-text-secondary">{t("intro")}</p>
        </div>
        <EditShared />
      </header>

      {blocks.length === 0 && <p className="rounded-xl border border-dashed border-app-border bg-white p-6 text-center text-sm text-app-text-secondary">{t("empty")}</p>}

      {blocks.map((b) => (
        <section key={b.id} className="rounded-xl border border-app-border bg-white px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium" dir="auto">{b.title}</h2>
              <div className="mt-0.5 text-xs text-app-text-secondary">
                {kindLabel(b.kind)} · {b.approved ? t("approvedVersion", { version: b.approved.version }) : t("noApproved")} · {t("key")} <span dir="ltr" className="font-jbmono">{b.key}</span>
              </div>
            </div>
            {b.approved && !b.pending && <EditShared block={{ key: b.key, title: b.title, kind: b.kind, body: b.approved.body }} />}
          </div>
          {b.approved && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed" dir="auto">{b.approved.body}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-app-text-secondary">
            <span>{t("usedBy")}</span>
            {b.usedBy.length === 0 ? <span className="text-app-text-tertiary">{t("usedByNone")}</span> : b.usedBy.map((a) => (
              <Link key={a.slug} href={`/app/agents/${a.slug}/instructions`} className="rounded-full border border-app-border px-2 py-0.5 hover:underline" dir="auto">{a.name}</Link>
            ))}
          </div>

          {b.pending && (
            <div className="mt-3 rounded-lg border border-app-border bg-app-accent-soft px-4 py-3">
              <div className="text-[13px] font-medium">{b.pending.createdByName ? t("pendingBy", { version: b.pending.version, name: b.pending.createdByName }) : t("pending", { version: b.pending.version })} · {when(b.pending.createdAt)}</div>
              {b.pending.changeNote && <p className="mt-1 text-[13px]" dir="auto">{t("why", { note: b.pending.changeNote })}</p>}
              <div className="mt-2 space-y-0.5 text-[13px] leading-relaxed" dir="auto">
                {diffLines(b.approved?.body ?? "", b.pending.body).map((l, i) => (
                  <div key={i} className={l.type === "add" ? "rounded bg-app-success-soft px-1" : l.type === "del" ? "rounded bg-app-error-soft px-1 line-through" : "px-1 text-app-text-secondary"}>
                    {l.type === "add" ? "+ " : l.type === "del" ? "- " : ""}{l.text || " "}
                  </div>
                ))}
              </div>
              {manager && (
                <div className="mt-3">
                  <DecideShared id={b.pending.id} version={b.pending.version} reach={b.usedBy.length} />
                </div>
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

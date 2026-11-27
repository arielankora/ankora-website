import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { Forbidden } from "@/components/app/Forbidden";
import { canManageClients } from "@/lib/app-auth/permissions";
import { mailScanErrorText } from "../error-text";
import { listChannelPeople, personLabel } from "@/lib/comms/channel-people";
import { visibleMailboxes } from "@/lib/mail-scan/channels";
import { changeMailOwnerAction, decideMailBlockAction, markSendersAction, revokeMailBlockAction, setMailExtractionAction } from "../actions";

// "סריקת תיבות דואר" (27.11.2026): each connected mailbox with its state,
// whose it is, what was recorded from it (counts only), and its "לא לקרוא"
// list, built like "שמירת שיחות WhatsApp" (../../setup/page.tsx). An
// employee sees their own mailboxes; a manager sees every one, decides the
// requests, turns extraction off and changes the owner.

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const primary = "min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white";
const secondary = "min-h-11 rounded-lg border border-app-border-strong bg-white px-3 text-sm text-app-text-primary";
const DONE = ["added", "requested", "approved", "rejected", "revoked", "extraction", "owner", "badTarget", "noneMarked"] as const;
const BAD_DONE = ["badTarget", "noneMarked"];

export default async function MailSetupPage(props: { searchParams: Promise<{ done?: string; err?: string }> }) {
  const query = await props.searchParams;
  const t = await getTranslations("comms.mail");
  const user = await requireUser();
  if (user.role === "CLIENT_USER") return <Forbidden />;
  const manager = canManageClients(user.role);
  const done = DONE.find((d) => d === query.done) ?? null;
  const errorText =
    query.err && /^mailScan\.\w+$/.test(query.err) ? await mailScanErrorText(query.err) : null;

  const channels = await visibleMailboxes(user);
  const people = manager ? (await listChannelPeople()).map((p) => ({ id: p.id, name: personLabel(p) })) : [];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link prefetch={false} href="/app/whatsapp-poc" className="inline-flex min-h-11 items-center text-sm text-app-text-primary underline">
          {t("back")}
        </Link>
        <h1 className="text-xl font-medium text-app-text-primary">{t("setup.title")}</h1>
        <p className="text-sm text-app-text-secondary">{t("setup.intro")}</p>
      </div>

      {done ? (
        <p
          role={BAD_DONE.includes(done) ? "alert" : "status"}
          className={`rounded-lg p-3 text-sm ${BAD_DONE.includes(done) ? "bg-app-error-soft text-app-error" : "bg-app-success-soft text-app-success"}`}
        >
          {t(`setup.done.${done}`)}
        </p>
      ) : null}
      {errorText ? (
        <p role="alert" className="rounded-lg bg-app-error-soft p-3 text-sm text-app-error">
          {t("result.error", { error: errorText })}
        </p>
      ) : null}

      {!channels.length ? (
        <p className="text-sm text-app-text-secondary">
          {t("setup.empty")}{" "}
          <Link prefetch={false} href="/app/whatsapp-poc/mail/connect" className="underline">
            {t("step1.button")}
          </Link>
        </p>
      ) : null}

      {channels.map((c) => {
        const pending = c.blocks.filter((b) => b.status === "PENDING");
        const active = c.blocks.filter((b) => b.status === "APPROVED");
        const kind = c.client ? t("mine.clientOf", { client: c.client.name }) : c.kindChosenAt ? t("mine.ankora") : t("mine.kindPending");
        return (
          <section key={c.id} className="space-y-4 rounded-2xl border border-app-border bg-white p-4">
            <div className="space-y-1 text-sm text-app-text-primary">
              <h2 className="text-base font-medium">
                {t("setup.mailboxOf", { name: c.owner.name ?? c.owner.email })}{" "}
                <span dir="ltr" className="text-sm font-normal text-app-text-secondary">
                  ({c.address})
                </span>
              </h2>
              <p>{t("setup.stateLine", { state: t(`mine.state.${c.state}`) })}</p>
              <p className="text-app-text-secondary">{t("setup.kindLine", { kind })}</p>
              {c.scanEnabled ? <p className="text-app-text-secondary">{t("setup.recorded", { threads: c._count.threads, clients: c.clientCount })}</p> : null}
            </div>

            {manager ? (
              <form action={setMailExtractionAction} className="flex flex-wrap items-center gap-3 text-sm text-app-text-primary">
                <input type="hidden" name="channelId" value={c.id} />
                <span>{t("setup.extractionLabel")}:</span>
                <label className="flex min-h-11 items-center gap-1">
                  <input type="checkbox" name="extractionAllowed" defaultChecked={c.extractionAllowed} /> {t("setup.extractionAllowed")}
                </label>
                <button type="submit" className={secondary}>
                  {t("setup.save")}
                </button>
              </form>
            ) : (
              <p className="text-sm text-app-text-secondary">{c.extractionAllowed ? t("setup.extractionOn") : t("setup.extractionOff")}</p>
            )}

            {manager ? (
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm text-app-text-primary underline">{t("setup.changeOwner")}</summary>
                <form action={changeMailOwnerAction} className="flex flex-wrap items-end gap-2 pb-2">
                  <input type="hidden" name="channelId" value={c.id} />
                  <div>
                    <label htmlFor={`mail-owner-${c.id}`} className="block text-xs font-medium text-app-text-secondary">
                      {t("setup.newOwner")}
                    </label>
                    <select id={`mail-owner-${c.id}`} name="ownerUserId" defaultValue="" className="mt-1 min-h-11 rounded-lg border border-app-border-strong bg-white px-2 text-sm">
                      <option value="" disabled>
                        {t("setup.pickUser")}
                      </option>
                      {people
                        .filter((p) => p.id !== c.ownerUserId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <button type="submit" className={secondary}>
                    {t("setup.save")}
                  </button>
                </form>
              </details>
            ) : null}

            <form action={markSendersAction} className="space-y-2">
              <input type="hidden" name="channelId" value={c.id} />
              <input type="hidden" name="back" value="setup" />
              <label htmlFor={`mail-add-${c.id}`} className="block text-sm font-medium text-app-text-primary">
                {t("setup.addHeading")}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={`mail-add-${c.id}`}
                  name="manual"
                  dir="ltr"
                  placeholder="name@example.com / example.com"
                  className="min-h-11 w-full max-w-xs rounded-lg border border-app-border-strong px-2 text-sm"
                />
                <button type="submit" className={secondary}>
                  {t("setup.add")}
                </button>
              </div>
            </form>

            {pending.length ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-app-text-primary">{t("setup.pendingHeading")}</h3>
                <ul className="space-y-3">
                  {pending.map((b) => (
                    <li key={b.id} className="space-y-2 rounded-lg bg-app-surface-sunken p-3">
                      <p className="text-sm text-app-text-primary">
                        {b.label ? <bdi>{b.label} </bdi> : null}
                        <span dir="ltr">{b.value}</span>{" "}
                        <span className="text-xs text-app-text-secondary">· {b.kind === "DOMAIN" ? t("setup.domain") : t("setup.address")}</span>
                      </p>
                      {manager ? (
                        <div className="flex flex-wrap gap-2">
                          <form action={decideMailBlockAction}>
                            <input type="hidden" name="blockId" value={b.id} />
                            <input type="hidden" name="decision" value="approve" />
                            <button type="submit" className={primary}>
                              {t("setup.approve")}
                            </button>
                          </form>
                          <form action={decideMailBlockAction}>
                            <input type="hidden" name="blockId" value={b.id} />
                            <input type="hidden" name="decision" value="reject" />
                            <button type="submit" className={secondary}>
                              {t("setup.reject")}
                            </button>
                          </form>
                        </div>
                      ) : (
                        <p className="text-xs text-app-text-secondary">{t("setup.awaitingManager")}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-app-text-primary underline">
                {t("setup.blockList", { count: active.length })}
              </summary>
              <ul className="divide-y divide-app-border">
                {active.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 text-sm text-app-text-primary">
                      {b.label ? <bdi>{b.label} </bdi> : null}
                      <span dir="ltr" className="text-xs text-app-text-secondary">
                        {b.value}
                      </span>{" "}
                      <span className="text-xs text-app-text-secondary">· {t(`setup.status.${b.status}`)}</span>
                    </span>
                    {manager ? (
                      <form action={revokeMailBlockAction}>
                        <input type="hidden" name="blockId" value={b.id} />
                        <button type="submit" className={secondary}>
                          {t("setup.revoke")}
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        );
      })}
    </div>
  );
}

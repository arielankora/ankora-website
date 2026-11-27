import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { parsePageNumber } from "@/lib/url-numbers";
import { cleanDetail } from "@/lib/mail-scan/connect-errors";
import { Forbidden } from "@/components/app/Forbidden";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { mailScanErrorText } from "../error-text";
import { kindOptions, senderSuggestions, visibleMailboxes } from "@/lib/mail-scan/channels";
import { chooseKindAction, markSendersAction, startMailConnectAction, startScanAction } from "../actions";

// "חיבור תיבת הדואר שלי" (27.11.2026): the employee's own steps, as on
// "חיבור ה-WhatsApp שלי" (../../connect/page.tsx): connect, whose mailbox
// it is, what not to read, and the switch. Below them, the employee's
// mailboxes with their state. The settings of each mailbox are on the
// settings page (../setup).

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const primary = "min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white";
const secondary = "min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm font-medium text-app-text-primary";
const RESULTS = [
  "connected",
  "reused",
  "reconnected",
  "kindSaved",
  "marked",
  "noneMarked",
  "badTarget",
  "active",
  "expired",
  "failed",
  "limit",
  "wrong-provider",
  "taken",
  "link-failed",
] as const;
type Result = (typeof RESULTS)[number];
const GOOD: Result[] = ["connected", "reused", "reconnected", "kindSaved", "marked", "active"];

export default async function ConnectMailboxPage(props: { searchParams: Promise<{ result?: string; count?: string; err?: string; why?: string }> }) {
  const query = await props.searchParams;
  const result = RESULTS.find((r) => r === query.result) ?? null;
  const t = await getTranslations("comms.mail");
  const format = await getFormatter();
  const user = await requireUser();
  if (user.role === "CLIENT_USER") return <Forbidden />;

  // What went wrong, from the way back (callback/route.ts), to pass on to
  // Ariel: Unipile's own words or the check that refused.
  const failedDetail = cleanDetail(query.why);
  const errorText =
    query.err && /^mailScan\.\w+$/.test(query.err) ? await mailScanErrorText(query.err) : null;
  const mine = await visibleMailboxes(user, { onlyOwn: true });
  // The mailbox the steps are about: the first one not scanning yet.
  const current = mine.find((c) => c.state === "choose-kind" || c.state === "not-scanning") ?? null;

  let stepSection: React.ReactNode = null;
  if (!mine.length) {
    stepSection = (
      <section className="space-y-3 rounded-xl border border-app-border bg-white p-4">
        <h2 className="font-medium text-app-text-primary">{t("step1.title")}</h2>
        <p className="text-sm text-app-text-secondary">{t("step1.why")}</p>
        <ol className="list-decimal space-y-1 ps-5 text-sm text-app-text-primary">
          <li>{t("step1.a")}</li>
          <li>{t("step1.b")}</li>
          <li>{t("step1.c")}</li>
        </ol>
        <p className="text-sm text-app-text-secondary">{t("step1.privacy")}</p>
        <form action={startMailConnectAction}>
          <button type="submit" className={primary}>
            {t("step1.button")}
          </button>
        </form>
      </section>
    );
  } else if (current?.state === "choose-kind") {
    const options = await kindOptions(user, current);
    const suggestedName = options.clients.find((c) => c.id === options.suggested[0])?.name ?? null;
    const preferClient = options.suggestedKind === "CLIENT";
    stepSection = (
      <section className="space-y-3 rounded-xl border border-app-border bg-white p-4">
        <h2 className="font-medium text-app-text-primary">
          {t("kind.title")}{" "}
          <span dir="ltr" className="text-sm font-normal text-app-text-secondary">
            ({current.address})
          </span>
        </h2>
        <p className="text-sm text-app-text-secondary">{suggestedName ? t("kind.hintSuggested", { client: suggestedName }) : t("kind.hint")}</p>
        <form action={chooseKindAction} className="space-y-3">
          <input type="hidden" name="channelId" value={current.id} />
          <label className="flex min-h-11 items-start gap-2 text-sm text-app-text-primary">
            <input type="radio" name="kind" value="ANKORA" defaultChecked={!preferClient} className="mt-1" />
            <span>{t("kind.ankora")}</span>
          </label>
          <div className="flex flex-wrap items-center gap-2 text-sm text-app-text-primary">
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="kind" value="CLIENT" defaultChecked={preferClient} />
              <span>{t("kind.client")}</span>
            </label>
            <label htmlFor="mail-kind-client" className="sr-only">
              {t("kind.pickClient")}
            </label>
            <select
              id="mail-kind-client"
              name="clientId"
              defaultValue={options.suggested[0] ?? ""}
              className="min-h-11 rounded-lg border border-app-border-strong bg-white px-2 text-sm"
            >
              <option value="">{t("kind.pickClient")}</option>
              {options.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={primary}>
            {t("kind.continue")}
          </button>
        </form>
      </section>
    );
  } else if (current?.state === "not-scanning") {
    let senders: Awaited<ReturnType<typeof senderSuggestions>> = [];
    let sendersError: string | null = null;
    try {
      senders = await senderSuggestions(current);
    } catch (err) {
      sendersError = (await domainErrorText(err)) ?? (err instanceof Error ? err.message : String(err));
    }
    stepSection = (
      <section className="space-y-3 rounded-xl border border-app-border bg-white p-4">
        <h2 className="font-medium text-app-success">
          {t("step2.connected")}{" "}
          <span dir="ltr" className="text-sm font-normal text-app-text-secondary">
            ({current.address})
          </span>
        </h2>
        <p className="text-sm text-app-text-secondary">
          {sendersError ? t("step2.sendersError", { error: sendersError }) : senders.length ? t("step2.why", { count: senders.length }) : t("step2.noSenders")}
        </p>
        <form action={markSendersAction} className="space-y-3">
          <input type="hidden" name="channelId" value={current.id} />
          {senders.length ? (
            <ul className="divide-y divide-app-border">
              {senders.map((s) => {
                const domain = s.address.split("@")[1] ?? "";
                return (
                  <li key={s.address} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 text-sm text-app-text-primary">
                      {/* The space sits between the two isolates, not inside the name's,
                          so a name in English does not run into the address. */}
                      {s.name ? (
                        <>
                          <bdi>{s.name}</bdi>{" "}
                        </>
                      ) : null}
                      <bdi dir="ltr" className="text-xs text-app-text-secondary">
                        {s.address}
                      </bdi>{" "}
                      <span className="text-xs text-app-text-secondary">· {t("step2.emails", { count: s.count })}</span>
                    </span>
                    {s.blocked ? (
                      <span className="text-xs text-app-text-secondary">{t("step2.alreadyBlocked")}</span>
                    ) : (
                      <span className="flex items-center gap-3 text-sm text-app-text-primary">
                        <label className="flex min-h-11 items-center gap-1">
                          <input type="checkbox" name="block" value={`ADDRESS|${s.address}|${s.name ?? ""}`} /> {t("step2.dontRead")}
                        </label>
                        <label className="flex min-h-11 items-center gap-1 text-app-text-secondary">
                          <input type="checkbox" name="block" value={`DOMAIN|${domain}|${s.name ?? ""}`} /> {t("step2.wholeDomain")}
                        </label>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div>
            <label htmlFor="mail-manual" className="block text-xs font-medium text-app-text-secondary">
              {t("step2.addManual")}
            </label>
            <input
              id="mail-manual"
              name="manual"
              dir="ltr"
              placeholder="name@example.com / example.com"
              className="mt-1 min-h-11 w-full max-w-xs rounded-lg border border-app-border-strong px-2 text-sm"
            />
          </div>
          <button type="submit" className={secondary}>
            {t("step2.saveMarks")}
          </button>
        </form>
        <h3 className="pt-2 text-sm font-medium text-app-text-primary">{t("step2.startHeading")}</h3>
        <form action={startScanAction} className="space-y-2 rounded-lg bg-app-surface-sunken p-3">
          <input type="hidden" name="channelId" value={current.id} />
          <p className="text-sm text-app-text-primary">{t("step2.startQuestion")}</p>
          <button type="submit" className={primary}>
            {t("step2.startButton")}
          </button>
        </form>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link prefetch={false} href="/app/whatsapp-poc" className="inline-flex min-h-11 items-center text-sm text-app-text-primary underline">
        {t("back")}
      </Link>
      <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>

      {result ? (
        <p
          role={GOOD.includes(result) ? "status" : "alert"}
          className={`rounded-lg p-3 text-sm ${GOOD.includes(result) ? "bg-app-success-soft text-app-success" : "bg-app-error-soft text-app-error"}`}
        >
          {t(`result.${result}`, { count: parsePageNumber(query.count, 200) })}
          {result === "failed" && failedDetail ? (
            <span className="mt-1 block text-xs">
              <bdi>{t("result.failedDetail", { detail: failedDetail })}</bdi>
            </span>
          ) : null}
        </p>
      ) : null}
      {errorText ? (
        <p role="alert" className="rounded-lg bg-app-error-soft p-3 text-sm text-app-error">
          {t("result.error", { error: errorText })}
        </p>
      ) : null}

      {stepSection}

      {mine.length ? (
        <section className="space-y-3 rounded-xl border border-app-border bg-white p-4">
          <h2 className="font-medium text-app-text-primary">{t("mine.title")}</h2>
          <ul className="space-y-3">
            {mine.map((c) => {
              const bad = c.state === "disconnected";
              return (
                <li key={c.id} className={`space-y-2 rounded-lg p-3 ${bad ? "border border-app-error bg-app-error-soft" : "bg-app-surface-sunken"}`}>
                  <p className="text-sm font-medium text-app-text-primary">
                    <span dir="ltr">{c.address}</span>{" "}
                    <span className="text-xs font-normal text-app-text-secondary">
                      · {c.client ? t("mine.clientOf", { client: c.client.name }) : c.kindChosenAt ? t("mine.ankora") : t("mine.kindPending")}
                    </span>
                  </p>
                  <p className={`text-sm ${bad ? "text-app-error" : c.state === "scanning" ? "text-app-success" : "text-app-text-secondary"}`}>
                    {t(`mine.state.${c.state}`)}
                    {c.state === "scanning" && c.lastEmailAt ? (
                      <span className="text-app-text-secondary">
                        {" "}
                        · {t("mine.lastEmail", { date: format.dateTime(c.lastEmailAt, { dateStyle: "short", timeStyle: "short" }) })}
                      </span>
                    ) : null}
                  </p>
                  {bad ? (
                    <form action={startMailConnectAction}>
                      <input type="hidden" name="channelId" value={c.id} />
                      <button type="submit" className={primary}>
                        {t("mine.reconnect")}
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-app-text-secondary">{t("mine.doneBody")}</p>
          <form action={startMailConnectAction}>
            <button type="submit" className={secondary}>
              {t("mine.addAnother")}
            </button>
          </form>
          <Link prefetch={false} href="/app/whatsapp-poc/mail/setup" className="flex min-h-11 items-center text-sm text-app-text-primary underline">
            {t("settingsLink")}
          </Link>
        </section>
      ) : null}
    </div>
  );
}

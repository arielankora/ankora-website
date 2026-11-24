import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { Forbidden } from "@/components/app/Forbidden";
import { needsReconnect, ownChannel, readAccount } from "@/lib/comms/self-connect";
import { activateStoringAction, startConnectAction } from "./actions";

// "חיבור ה-WhatsApp שלי" (24.11.2026): the employee's own two steps,
// connect and activate (lib/comms/self-connect.ts). The number's settings
// ("לא לשמור", who does not see it) stay on the setup screen.

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const primary = "min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white";
const RESULTS = ["connected", "reconnected", "active", "expired", "failed", "wrong-provider", "taken", "link-failed"] as const;
type Result = (typeof RESULTS)[number];
const GOOD: Result[] = ["connected", "reconnected", "active"];

export default async function ConnectWhatsappPage(props: { searchParams: Promise<{ result?: string }> }) {
  const { result: raw } = await props.searchParams;
  const result = RESULTS.find((r) => r === raw) ?? null;
  const t = await getTranslations("comms.connect");
  const user = await requireUser();
  if (user.role === "CLIENT_USER") return <Forbidden />;

  const channel = await ownChannel(user.id);
  let status: string | null = null;
  if (channel) {
    try {
      status = (await readAccount(channel.accountId)).status;
    } catch {
      status = null;
    }
  }
  const disconnected = status !== null && needsReconnect(status);

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
          {t(`result.${result}`)}
        </p>
      ) : null}

      <section className="space-y-3 rounded-xl border border-app-border bg-white p-4">
        {!channel ? (
          <>
            <h2 className="font-medium text-app-text-primary">{t("step1.title")}</h2>
            <p className="text-sm text-app-text-secondary">{t("step1.why")}</p>
            <ol className="list-decimal space-y-1 ps-5 text-sm text-app-text-primary">
              <li>{t("step1.a")}</li>
              <li>{t("step1.b")}</li>
              <li>{t("step1.c")}</li>
            </ol>
            <p className="text-sm text-app-text-secondary">{t("step1.privacy")}</p>
            <form action={startConnectAction}>
              <button type="submit" className={primary}>
                {t("step1.button")}
              </button>
            </form>
          </>
        ) : disconnected ? (
          <>
            <h2 className="font-medium text-app-error">{t("reconnect.title")}</h2>
            <p className="text-sm text-app-text-secondary">{t("reconnect.why")}</p>
            <form action={startConnectAction}>
              <button type="submit" className={primary}>
                {t("reconnect.button")}
              </button>
            </form>
          </>
        ) : !channel.storeEnabled ? (
          <>
            <h2 className="font-medium text-app-success">{t("step2.connected")}</h2>
            <p className="text-sm text-app-text-secondary">{t("step2.why")}</p>
            <form action={activateStoringAction}>
              <button type="submit" className={primary}>
                {t("step2.button")}
              </button>
            </form>
            <p className="text-sm text-app-text-secondary">
              {t("step2.later")}{" "}
              <Link prefetch={false} href="/app/whatsapp-poc/setup" className="underline">
                {t("settingsLink")}
              </Link>
            </p>
          </>
        ) : (
          <>
            <h2 className="font-medium text-app-success">{t("done.title")}</h2>
            <p className="text-sm text-app-text-secondary">{t("done.body")}</p>
            <Link prefetch={false} href="/app/whatsapp-poc/setup" className="inline-flex min-h-11 items-center text-sm underline">
              {t("settingsLink")}
            </Link>
          </>
        )}
      </section>
    </div>
  );
}

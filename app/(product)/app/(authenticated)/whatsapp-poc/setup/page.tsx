import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { Forbidden } from "@/components/app/Forbidden";
import { canManageClients } from "@/lib/app-auth/permissions";
import { canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { chatPhone, displayPhone } from "@/lib/whatsapp-poc/inbox";
import { UnipileError, isConfigured, loadMergedChats, readPocConfig, type PocChat } from "@/lib/whatsapp-poc/unipile";
import { blockStateFor } from "@/lib/comms/visibility";
import { prisma } from "@/lib/prisma";
import { BlockManyForm, ConnectForm, DecideForm, LoadHistoryForm, RevokeForm, StartForm, type SetupRow } from "./SetupForms";

// Communications storage, stage 3 (1.11.2026): connecting a WhatsApp number
// for storing, the "לא לשמור" list before anything is kept, "התחל לשמור",
// and the block list afterwards (pending requests, active blocks).

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUS_LABEL = { PENDING: "ממתין למנהל", APPROVED: "חסום", REJECTED: "נדחה", REVOKED: "בוטל" } as const;

export default async function CommsSetupPage(props: { searchParams: Promise<{ started?: string }> }) {
  const { started } = await props.searchParams;
  const user = await requireUser();
  const config = readPocConfig();
  if (!canViewWhatsappPoc(user, config.viewers)) return <Forbidden />;
  const manager = canManageClients(user.role);

  const header = (
    <div className="space-y-1">
      <Link prefetch={false} href="/app/whatsapp-poc" className="inline-flex min-h-11 items-center text-sm text-app-text-primary underline">
        חזרה למסך התקשורת
      </Link>
      <h1 className="text-xl font-medium text-app-text-primary">שמירת שיחות WhatsApp</h1>
      <p className="text-sm text-app-text-secondary">
        כל השיחות של המספר נשמרות, חוץ ממה שמסמנים &quot;לא לשמור&quot;. חסימה של מנהל נכנסת לתוקף מיד ומוחקת מה שנשמר. חסימה של עובד
        מסתירה את ההודעות עד שמנהל מחליט.
      </p>
    </div>
  );

  if (!isConfigured(config)) {
    return (
      <div className="space-y-4">
        {header}
        <p className="text-sm text-app-text-secondary">חשבון WhatsApp לא מוגדר בסביבה הזו.</p>
      </div>
    );
  }

  const channel = await prisma.commsChannel.findUnique({
    where: { accountId: config.accountId },
    include: { owner: { select: { name: true } }, blocks: { orderBy: { requestedAt: "desc" } } },
  });

  if (!channel) {
    const people = await prisma.user.findMany({
      where: { deletedAt: null, role: { not: "CLIENT_USER" }, id: { not: user.id } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return (
      <div className="space-y-4">
        {header}
        <section className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
          <h2 className="text-base font-medium text-app-text-primary">שלב 1: חיבור המספר</h2>
          <p className="text-sm text-app-text-secondary">המספר יהיה שלך. שום דבר לא נשמר עד שתלחץ &quot;התחל לשמור&quot; בשלב הבא.</p>
          <ConnectForm people={people.map((p) => ({ id: p.id, name: p.name ?? p.id }))} />
        </section>
      </div>
    );
  }

  const isOwnerOrManager = channel.ownerUserId === user.id || manager;
  const excludedNames = channel.excludedViewerIds.length
    ? (await prisma.user.findMany({ where: { id: { in: channel.excludedViewerIds } }, select: { name: true } })).map((u) => u.name)
    : [];

  let chats: PocChat[] = [];
  let chatsError: string | null = null;
  if (!channel.storeEnabled) {
    try {
      chats = (await loadMergedChats(config)).chats;
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      chatsError = err.message;
    }
  }
  const rows: SetupRow[] = chats.map((c) => {
    const phone = chatPhone(c);
    const kind = phone ? "PHONE" : "CHAT";
    const value = phone ?? c.id;
    return {
      key: c.id,
      value: `${kind}|${value}|${c.name}`,
      name: c.name,
      detail: phone ? displayPhone(phone) : c.type === "group" ? "קבוצה" : "",
      blocked: blockStateFor(channel.blocks, { phone, chatId: c.id }) !== "none",
    };
  });

  const loaded = channel.storeEnabled
    ? await prisma.commsConversation.count({ where: { channelId: channel.id, backfilledAt: { not: null } } })
    : 0;
  const pending = channel.blocks.filter((b) => b.status === "PENDING");
  const active = channel.blocks.filter((b) => b.status === "APPROVED");

  return (
    <div className="space-y-4">
      {header}

      {started === "1" && channel.storeEnabled ? (
        <p role="status" className="rounded-lg bg-app-success-soft p-3 text-sm text-app-text-primary">
          השמירה התחילה. מעכשיו כל הודעה חדשה נשמרת, חוץ ממה שברשימת החסימה. ההיסטוריה של השיחות נטענת בהדרגה, בריצה הלילית.
        </p>
      ) : null}

      <section className="space-y-1 rounded-2xl border border-app-border bg-white p-4 text-sm text-app-text-primary">
        <p>
          המספר מחובר. בעלים: {channel.owner.name}. מצב: {channel.storeEnabled ? "נשמר" : "עוד לא נשמר"}.
        </p>
        {excludedNames.length ? <p className="text-app-text-secondary">לא רואים שיחות מהמספר: {excludedNames.join(", ")}.</p> : null}
        {channel.storeEnabled ? (
          <p className="text-app-text-secondary">
            היסטוריה: נטענו {loaded} שיחות. ההמשך נטען בריצה הלילית, או עכשיו:
          </p>
        ) : null}
        {channel.storeEnabled && isOwnerOrManager ? <LoadHistoryForm channelId={channel.id} /> : null}
      </section>

      {!channel.storeEnabled && isOwnerOrManager ? (
        <section className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
          <h2 className="text-base font-medium text-app-text-primary">שלב 2: מה לא לשמור</h2>
          <p className="text-sm text-app-text-secondary">
            סמנו כל שיחה אישית שלא צריכה להישמר, ולחצו &quot;שמירת הסימונים&quot;. אפשר לחזור לכאן ולהוסיף. מוצגות {rows.length} השיחות האחרונות.
          </p>
          {chatsError ? (
            <p role="alert" className="rounded-lg bg-app-error-soft p-3 text-sm text-app-error">
              {chatsError}
            </p>
          ) : null}
          <BlockManyForm channelId={channel.id} rows={rows} />
          <h2 className="pt-2 text-base font-medium text-app-text-primary">שלב 3: התחלת השמירה</h2>
          <StartForm channelId={channel.id} />
        </section>
      ) : null}

      {pending.length > 0 ? (
        <section className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
          <h2 className="text-base font-medium text-app-text-primary">בקשות חסימה שממתינות</h2>
          <ul className="space-y-3">
            {pending.map((b) => (
              <li key={b.id} className="space-y-2 rounded-lg bg-app-surface-sunken p-3">
                <p className="text-sm text-app-text-primary">
                  {b.label ?? "ללא שם"}{" "}
                  <span dir="ltr" className="text-xs text-app-text-secondary">
                    {b.kind === "PHONE" ? displayPhone(b.value) : "קבוצה"}
                  </span>
                </p>
                {manager ? <DecideForm blockId={b.id} /> : <p className="text-xs text-app-text-secondary">ממתין להחלטת מנהל.</p>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
        <h2 className="text-base font-medium text-app-text-primary">רשימת החסימה</h2>
        {active.length === 0 ? <p className="text-sm text-app-text-secondary">אין חסימות.</p> : null}
        <ul className="divide-y divide-app-border">
          {active.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-app-text-primary">
                {b.label ?? "ללא שם"}{" "}
                <span dir="ltr" className="text-xs text-app-text-secondary">
                  {b.kind === "PHONE" ? displayPhone(b.value) : "קבוצה"}
                </span>{" "}
                <span className="text-xs text-app-text-secondary">· {STATUS_LABEL[b.status]}</span>
              </span>
              {manager ? <RevokeForm blockId={b.id} /> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

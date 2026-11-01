import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { Forbidden } from "@/components/app/Forbidden";
import { canManageClients } from "@/lib/app-auth/permissions";
import { chatPhone, displayPhone } from "@/lib/whatsapp-poc/inbox";
import { UnipileError, listWhatsappAccounts, loadMergedChats, type PocChat } from "@/lib/whatsapp-poc/unipile";
import { blockStateFor } from "@/lib/comms/visibility";
import { commsAccess } from "@/lib/comms/access";
import { prisma } from "@/lib/prisma";
import { BlockManyForm, ConnectForm, DecideForm, LoadHistoryForm, RevokeForm, StartForm, type SetupRow } from "./SetupForms";

// Communications storage (1.11.2026): the WhatsApp numbers connected for
// storing, each with its "לא לשמור" list before anything is kept, "התחל
// לשמור", and its block list afterwards (pending requests, active blocks).
// Several numbers: Ariel's, Hadas's, Anna's, each owned by its person.

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUS_LABEL = { PENDING: "ממתין למנהל", APPROVED: "חסום", REJECTED: "נדחה", REVOKED: "בוטל" } as const;

export default async function CommsSetupPage(props: { searchParams: Promise<{ started?: string }> }) {
  const { started } = await props.searchParams;
  const user = await requireUser();
  const access = await commsAccess(user);
  const manager = canManageClients(user.role);
  // Anyone on staff may connect their own number; nothing else is shown to
  // someone with no number and no access.
  if (user.role === "CLIENT_USER") return <Forbidden />;
  const apiKey = process.env.UNIPILE_API_KEY?.trim() || null;

  const channels = await prisma.commsChannel.findMany({
    where: manager || access.full ? {} : { ownerUserId: user.id },
    include: { owner: { select: { name: true } }, blocks: { orderBy: { requestedAt: "desc" } } },
    orderBy: { createdAt: "asc" },
  });

  const people = await prisma.user.findMany({
    where: { deletedAt: null, role: { not: "CLIENT_USER" } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.name ?? p.email]));

  // Accounts the API key reaches, not connected yet, for the connect form.
  let accounts: Array<{ id: string; name: string }> = [];
  let accountsError: string | null = null;
  if (apiKey) {
    try {
      const connected = new Set((await prisma.commsChannel.findMany({ select: { accountId: true } })).map((c) => c.accountId));
      accounts = (await listWhatsappAccounts(apiKey)).filter((a) => !connected.has(a.id));
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      accountsError = err.message;
    }
  }

  const sections = [];
  for (const channel of channels) {
    const isOwnerOrManager = channel.ownerUserId === user.id || manager;
    let rows: SetupRow[] = [];
    let chatsError: string | null = null;
    if (!channel.storeEnabled && isOwnerOrManager && apiKey) {
      let chats: PocChat[] = [];
      try {
        chats = (await loadMergedChats({ apiKey, accountId: channel.accountId })).chats;
      } catch (err) {
        if (!(err instanceof UnipileError)) throw err;
        chatsError = err.message;
      }
      rows = chats.map((c) => {
        const phone = chatPhone(c);
        const kind = phone ? "PHONE" : "CHAT";
        return {
          key: c.id,
          value: `${kind}|${phone ?? c.id}|${c.name}`,
          name: c.name,
          detail: phone ? displayPhone(phone) : c.type === "group" ? "קבוצה" : "",
          blocked: blockStateFor(channel.blocks, { phone, chatId: c.id }) !== "none",
        };
      });
    }
    const loaded = channel.storeEnabled
      ? await prisma.commsConversation.count({ where: { channelId: channel.id, backfilledAt: { not: null } } })
      : 0;
    const pending = channel.blocks.filter((b) => b.status === "PENDING");
    const active = channel.blocks.filter((b) => b.status === "APPROVED");
    const excludedNames = channel.excludedViewerIds.map((id) => nameOf.get(id) ?? id);

    sections.push(
      <section key={channel.id} className="space-y-4 rounded-2xl border border-app-border bg-white p-4">
        <div className="space-y-1 text-sm text-app-text-primary">
          <h2 className="text-base font-medium">המספר של {channel.owner.name}</h2>
          <p>מצב: {channel.storeEnabled ? "נשמר" : "עוד לא נשמר"}.</p>
          {excludedNames.length ? <p className="text-app-text-secondary">לא רואים שיחות מהמספר: {excludedNames.join(", ")}.</p> : null}
          {channel.storeEnabled ? <p className="text-app-text-secondary">היסטוריה: נטענו {loaded} שיחות. ההמשך נטען בריצה הלילית, או עכשיו:</p> : null}
        </div>
        {channel.storeEnabled && isOwnerOrManager ? <LoadHistoryForm channelId={channel.id} /> : null}

        {!channel.storeEnabled && isOwnerOrManager ? (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-app-text-primary">מה לא לשמור</h3>
            <p className="text-sm text-app-text-secondary">
              סמנו כל שיחה אישית שלא צריכה להישמר, ולחצו &quot;שמירת הסימונים&quot;. מוצגות {rows.length} השיחות האחרונות.
            </p>
            {chatsError ? (
              <p role="alert" className="rounded-lg bg-app-error-soft p-3 text-sm text-app-error">
                {chatsError}
              </p>
            ) : null}
            <BlockManyForm channelId={channel.id} rows={rows} />
            <h3 className="pt-2 text-sm font-medium text-app-text-primary">התחלת השמירה</h3>
            <StartForm channelId={channel.id} />
          </div>
        ) : null}

        {pending.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-app-text-primary">בקשות חסימה שממתינות</h3>
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
          </div>
        ) : null}

        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-app-text-primary underline">
            רשימת החסימה ({active.length})
          </summary>
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
        </details>
      </section>,
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link prefetch={false} href="/app/whatsapp-poc" className="inline-flex min-h-11 items-center text-sm text-app-text-primary underline">
          חזרה למסך התקשורת
        </Link>
        <h1 className="text-xl font-medium text-app-text-primary">שמירת שיחות WhatsApp</h1>
        <p className="text-sm text-app-text-secondary">
          כל השיחות של מספר נשמרות, חוץ ממה שמסמנים &quot;לא לשמור&quot;. חסימה של מנהל נכנסת לתוקף מיד ומוחקת מה שנשמר. חסימה של עובד
          מסתירה את ההודעות עד שמנהל מחליט.
        </p>
      </div>

      {started === "1" ? (
        <p role="status" className="rounded-lg bg-app-success-soft p-3 text-sm text-app-text-primary">
          השמירה התחילה. מעכשיו כל הודעה חדשה נשמרת, חוץ ממה שברשימת החסימה. ההיסטוריה של השיחות נטענת בהדרגה.
        </p>
      ) : null}

      {sections}

      <section className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
        <h2 className="text-base font-medium text-app-text-primary">חיבור מספר</h2>
        <p className="text-sm text-app-text-secondary">
          קודם מחברים את המספר ב-Unipile. אחרי החיבור כאן, שום דבר לא נשמר עד שבעל המספר עובר על הרשימה ולוחץ &quot;התחל לשמור&quot;.
        </p>
        {accountsError ? (
          <p className="text-sm text-app-text-secondary">לא הצלחתי לקבל מ-Unipile את רשימת המספרים ({accountsError}). אפשר להקליד את מזהה החשבון.</p>
        ) : null}
        <ConnectForm
          accounts={accounts}
          manualAccount={accounts.length === 0}
          people={people.filter((p) => p.id !== user.id || manager).map((p) => ({ id: p.id, name: p.name ?? p.email }))}
          owners={manager ? people.map((p) => ({ id: p.id, name: p.name ?? p.email })) : null}
          selfId={user.id}
        />
      </section>
    </div>
  );
}

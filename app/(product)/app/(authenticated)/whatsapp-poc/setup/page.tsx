import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { Forbidden } from "@/components/app/Forbidden";
import { canManageClients } from "@/lib/app-auth/permissions";
import { chatPhone, displayPhone } from "@/lib/whatsapp-poc/inbox";
import { UnipileError, listWhatsappAccounts, loadMergedChats, type PocChat } from "@/lib/whatsapp-poc/unipile";
import { blockStateFor } from "@/lib/comms/visibility";
import { commsAccess } from "@/lib/comms/access";
import { prisma } from "@/lib/prisma";
import { listChannelPeople, personLabel } from "@/lib/comms/channel-people";
import {
  BlockManyForm,
  ChangeOwnerForm,
  ConnectForm,
  DecideForm,
  ExcludedViewersForm,
  LoadHistoryForm,
  ManualRecordingsForm,
  NewChatsReview,
  RevokeForm,
  StartForm,
  type NewChatRow,
  type SetupRow,
} from "./SetupForms";
import { listChatsToReview } from "@/lib/comms/new-chats";

// Communications storage (1.11.2026): the WhatsApp numbers connected for
// storing, each with its "לא לשמור" list before anything is kept, "התחל
// לשמור", and its block list afterwards (pending requests, active blocks).
// Several numbers: Ariel's, Hadas's, Anna's, each owned by its person.

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CommsSetupPage(props: { searchParams: Promise<{ started?: string }> }) {
  const { started } = await props.searchParams;
  const t = await getTranslations("comms.setup");
  const tc = await getTranslations("comms");
  const format = await getFormatter();
  const shownPhone = (phone: string) => displayPhone(phone, tc("phone.whatsappId"));
  const user = await requireUser();
  const access = await commsAccess(user);
  const manager = canManageClients(user.role);
  // Anyone on staff may connect their own number; nothing else is shown to
  // someone with no number and no access.
  if (user.role === "CLIENT_USER") return <Forbidden />;
  const apiKey = process.env.UNIPILE_API_KEY?.trim() || null;

  const channels = await prisma.commsChannel.findMany({
    where: manager || access.full ? {} : { ownerUserId: user.id },
    include: { owner: { select: { name: true, email: true } }, blocks: { orderBy: { requestedAt: "desc" } } },
    orderBy: { createdAt: "asc" },
  });

  // Only people who can sign in may own a number or be on its "מי לא יראה"
  // list (lib/comms/channel-people.ts), each shown with their email, since
  // two people can share a name (5.11.2026: two "Anna Kozlov").
  const people = (await listChannelPeople()).map((p) => ({ id: p.id, name: personLabel(p) }));
  // Names of people already on a list, whatever their status now.
  const listedIds = [...new Set(channels.flatMap((c) => c.excludedViewerIds))];
  const listed = listedIds.length
    ? await prisma.user.findMany({ where: { id: { in: listedIds } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = new Map(listed.map((p) => [p.id, personLabel(p)]));

  // Accounts the API key reaches, not connected yet, for the connect form.
  let accounts: Array<{ id: string; name: string }> = [];
  let accountsError: string | null = null;
  if (apiKey) {
    try {
      const connected = new Set((await prisma.commsChannel.findMany({ select: { accountId: true } })).map((c) => c.accountId));
      accounts = (await listWhatsappAccounts(apiKey)).filter((a) => !connected.has(a.id));
    } catch (err) {
      if (!(err instanceof UnipileError)) throw err;
      accountsError = (await domainErrorText(err)) ?? err.message;
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
        chatsError = (await domainErrorText(err)) ?? err.message;
      }
      rows = chats.map((c) => {
        const phone = chatPhone(c);
        const kind = phone ? "PHONE" : "CHAT";
        return {
          key: c.id,
          value: `${kind}|${phone ?? c.id}|${c.name}`,
          name: c.name,
          detail: phone ? shownPhone(phone) : c.type === "group" ? t("group") : "",
          blocked: blockStateFor(channel.blocks, { phone, chatId: c.id }) !== "none",
        };
      });
    }
    const loaded = channel.storeEnabled
      ? await prisma.commsConversation.count({ where: { channelId: channel.id, backfilledAt: { not: null } } })
      : 0;
    const pending = channel.blocks.filter((b) => b.status === "PENDING");
    // "שיחות חדשות לבדיקה" (design 9): for the owner and the managers.
    const review = channel.storeEnabled && isOwnerOrManager ? await listChatsToReview(channel) : { chats: [], total: 0 };
    const reviewRows: NewChatRow[] = review.chats.map((c) => ({
      conversationId: c.conversationId,
      name: c.name,
      detail: [
        c.isGroup ? t("group") : c.phone ? shownPhone(c.phone) : null,
        t("messages", { count: c.messages }),
        c.firstAt ? t("since", { date: format.dateTime(new Date(c.firstAt), { day: "numeric", month: "numeric" }) }) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      clients: c.clients,
    }));
    const active = channel.blocks.filter((b) => b.status === "APPROVED");
    const excludedNames = channel.excludedViewerIds.map((id) => nameOf.get(id) ?? id);

    sections.push(
      <section key={channel.id} className="space-y-4 rounded-2xl border border-app-border bg-white p-4">
        <div className="space-y-1 text-sm text-app-text-primary">
          <h2 className="text-base font-medium">
            {t("numberOf", { name: channel.owner.name ?? "" })}{" "}
            <span dir="ltr" className="text-sm font-normal text-app-text-secondary">
              ({channel.owner.email})
            </span>
          </h2>
          <p>{channel.storeEnabled ? t("stateStored") : t("stateNotStored")}</p>
          {isOwnerOrManager ? (
            <ExcludedViewersForm
              channelId={channel.id}
              people={people.filter((p) => p.id !== channel.ownerUserId)}
              excluded={channel.excludedViewerIds}
              labels={Object.fromEntries(channel.excludedViewerIds.map((id) => [id, nameOf.get(id) ?? id]))}
              locked={channel.ownerUserId !== user.id && channel.excludedViewerIds.includes(user.id) ? [user.id] : []}
              excludeAll={channel.excludeAllViewers}
              allLocked={channel.ownerUserId !== user.id}
            />
          ) : channel.excludeAllViewers ? (
            <p className="text-app-text-secondary">{t("excludedAll")}</p>
          ) : excludedNames.length ? (
            <p className="text-app-text-secondary">{t("excludedSome", { names: excludedNames.join(", ") })}</p>
          ) : null}
          {channel.storeEnabled ? <p className="text-app-text-secondary">{t("history", { count: loaded })}</p> : null}
        </div>
        {channel.storeEnabled && isOwnerOrManager ? <LoadHistoryForm channelId={channel.id} /> : null}
        {manager ? (
          <ChangeOwnerForm
            channelId={channel.id}
            current={personLabel(channel.owner)}
            candidates={people.filter((p) => p.id !== channel.ownerUserId)}
          />
        ) : null}

        {!channel.storeEnabled && isOwnerOrManager ? (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-app-text-primary">{t("whatNotToStore")}</h3>
            <p className="text-sm text-app-text-secondary">{t("whatNotToStoreHint", { count: rows.length })}</p>
            {chatsError ? (
              <p role="alert" className="rounded-lg bg-app-error-soft p-3 text-sm text-app-error">
                {chatsError}
              </p>
            ) : null}
            <BlockManyForm channelId={channel.id} rows={rows} />
            <h3 className="pt-2 text-sm font-medium text-app-text-primary">{t("startHeading")}</h3>
            <StartForm channelId={channel.id} />
          </div>
        ) : null}

        {reviewRows.length > 0 ? (
          <div id={`review-${channel.id}`}>
            <NewChatsReview channelId={channel.id} rows={reviewRows} total={review.total} manager={manager} />
          </div>
        ) : null}

        {pending.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-app-text-primary">{t("pendingHeading")}</h3>
            <ul className="space-y-3">
              {pending.map((b) => (
                <li key={b.id} className="space-y-2 rounded-lg bg-app-surface-sunken p-3">
                  <p className="text-sm text-app-text-primary">
                    <bdi>{b.label ?? tc("noName")}</bdi>{" "}
                    <span dir="ltr" className="text-xs text-app-text-secondary">
                      {b.kind === "PHONE" ? shownPhone(b.value) : t("group")}
                    </span>
                  </p>
                  {manager ? <DecideForm blockId={b.id} /> : <p className="text-xs text-app-text-secondary">{t("awaitingManager")}</p>}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-app-text-primary underline">
            {t("blockList", { count: active.length })}
          </summary>
          <ul className="divide-y divide-app-border">
            {active.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-app-text-primary">
                  <bdi>{b.label ?? tc("noName")}</bdi>{" "}
                  <span dir="ltr" className="text-xs text-app-text-secondary">
                    {b.kind === "PHONE" ? shownPhone(b.value) : t("group")}
                  </span>{" "}
                  <span className="text-xs text-app-text-secondary">· {t(`status.${b.status}`)}</span>
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
          {t("backToComms")}
        </Link>
        <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
        <p className="text-sm text-app-text-secondary">{t("intro")}</p>
      </div>

      {started === "1" ? (
        <p role="status" className="rounded-lg bg-app-success-soft p-3 text-sm text-app-text-primary">
          {t("started")}
        </p>
      ) : null}

      {sections}

      {manager ? (
        <section className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
          <h2 className="text-base font-medium text-app-text-primary">{t("manualHeading")}</h2>
          <p className="text-sm text-app-text-secondary">{t("manualIntro")}</p>
          <ManualRecordingsForm />
        </section>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
        <h2 className="text-base font-medium text-app-text-primary">{t("connectHeading")}</h2>
        <p className="text-sm text-app-text-secondary">{t("connectIntro")}</p>
        {accountsError ? <p className="text-sm text-app-text-secondary">{t("accountsError", { error: accountsError })}</p> : null}
        <ConnectForm
          accounts={accounts}
          manualAccount={accounts.length === 0}
          people={people.filter((p) => p.id !== user.id || manager)}
          owners={manager ? people : null}
          selfId={user.id}
        />
      </section>
    </div>
  );
}

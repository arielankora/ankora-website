import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronDown } from "lucide-react";
import type { User } from "@prisma/client";
import { needsReconnect, ownChannel, readAccount } from "@/lib/comms/self-connect";
import { visibleMailboxes } from "@/lib/mail-scan/channels";
import { FilterMenu } from "./CommsControls";

// "חיבורים והגדרות" (27.11.2026, Ariel chose option B of the design on
// Claude Design): the communications screen's header had four long links
// of the same weight. Now one button opens a menu: what is the employee's
// own above (their WhatsApp, their mailboxes, each with its state), the
// team's settings below. A dot on the button says whether all of theirs is
// connected (green) or something needs them (orange).

type Tone = "ok" | "attention" | "none";
type Line = { href: string; label: string; state: string | null; tone: Tone };

const DOT: Record<Tone, string> = { ok: "bg-app-success", attention: "bg-app-warning", none: "bg-app-border-strong" };
const STATE_TEXT: Record<Tone, string> = { ok: "text-app-success", attention: "text-app-warning", none: "text-app-text-secondary" };

async function whatsappState(userId: string): Promise<Tone | "missing"> {
  const channel = await ownChannel(userId);
  if (!channel) return "missing";
  try {
    return needsReconnect((await readAccount(channel.accountId)).status) ? "attention" : "ok";
  } catch {
    return "none";
  }
}

type MailKey = "none" | "disconnected" | "unfinished" | "unknown" | "scanning";

async function mailState(user: Pick<User, "id" | "email" | "role">): Promise<{ tone: Tone | "missing"; count: number; key: MailKey }> {
  const mine = await visibleMailboxes(user as User, { onlyOwn: true });
  if (!mine.length) return { tone: "missing", count: 0, key: "none" };
  if (mine.some((c) => c.state === "disconnected")) return { tone: "attention", count: mine.length, key: "disconnected" };
  if (mine.some((c) => c.state === "choose-kind" || c.state === "not-scanning")) return { tone: "attention", count: mine.length, key: "unfinished" };
  if (mine.every((c) => c.state === "unknown")) return { tone: "none", count: mine.length, key: "unknown" };
  return { tone: "ok", count: mine.length, key: "scanning" };
}

/// The menu itself. It reads the states from Unipile, so the page shows it
/// inside <Suspense> with `ConnectionsMenuButton` as the fallback.
export async function ConnectionsMenu({ user }: { user: Pick<User, "id" | "email" | "role"> }) {
  const t = await getTranslations("comms.connections");
  const [wa, mail] = await Promise.all([whatsappState(user.id), mailState(user)]);
  const mine: Line[] = [
    {
      href: "/app/whatsapp-poc/connect",
      label: t("myWhatsapp"),
      state: wa === "missing" ? t("wa.missing") : wa === "ok" ? t("wa.ok") : wa === "attention" ? t("wa.attention") : null,
      tone: wa === "missing" ? "none" : wa,
    },
    {
      href: "/app/whatsapp-poc/mail/connect",
      label: t("myMailboxes"),
      state: t(`mail.${mail.key}`, { count: mail.count }),
      tone: mail.tone === "missing" ? "none" : mail.tone,
    },
  ];
  const team: Line[] = [
    { href: "/app/whatsapp-poc/setup", label: t("teamWhatsapp"), state: null, tone: "none" },
    { href: "/app/whatsapp-poc/mail/setup", label: t("teamMail"), state: null, tone: "none" },
  ];
  const tones = mine.map((l) => l.tone);
  const dot: Tone = tones.includes("attention") ? "attention" : tones.every((x) => x === "ok") ? "ok" : "none";
  return (
    <FilterMenu className="relative">
      <MenuSummary label={t("button")} dot={dot} dotLabel={dot === "attention" ? t("needsYou") : dot === "ok" ? t("allConnected") : null} />
      <div className="absolute end-0 z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-app-border bg-white p-2 shadow-lg">
        <Section title={t("mine")} lines={mine} />
        <div className="mx-3 my-1.5 h-px bg-app-border" />
        <Section title={t("team")} lines={team} />
      </div>
    </FilterMenu>
  );
}

/// The button alone, while the states load.
export async function ConnectionsMenuButton() {
  const t = await getTranslations("comms.connections");
  return (
    <span className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-app-border-strong bg-white px-4 text-sm font-medium text-app-text-primary">
      <span className={`size-2 rounded-full ${DOT.none}`} aria-hidden="true" />
      {t("button")}
      <ChevronDown className="size-4" aria-hidden="true" />
    </span>
  );
}

function MenuSummary({ label, dot, dotLabel }: { label: string; dot: Tone; dotLabel: string | null }) {
  return (
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-app-border-strong bg-white px-4 text-sm font-medium text-app-text-primary">
      <span className={`size-2 rounded-full ${DOT[dot]}`} aria-hidden="true" />
      {label}
      {dotLabel ? <span className="sr-only">{dotLabel}</span> : null}
      <ChevronDown className="size-4" aria-hidden="true" />
    </summary>
  );
}

function Section({ title, lines }: { title: string; lines: Line[] }) {
  return (
    <div>
      <p className="px-3 pb-1 pt-2 text-xs font-semibold text-app-text-tertiary">{title}</p>
      <ul>
        {lines.map((l) => (
          <li key={l.href}>
            <Link
              prefetch={false}
              href={l.href}
              className="flex min-h-12 items-center justify-between gap-3 rounded-lg px-3 text-sm text-app-text-primary hover:bg-app-surface-sunken"
            >
              <span>{l.label}</span>
              {l.state ? <span className={`text-xs ${STATE_TEXT[l.tone]}`}>{l.state}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

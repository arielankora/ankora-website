"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

// The client filter. Each option's address is built on the server, from
// the same calendarHref as every other control, so this component does
// not need to know which keys the calendar has.
export function CalendarClientSelect({
  clients,
  value,
  hrefs,
}: {
  clients: { id: string; name: string }[];
  value: string;
  hrefs: Record<string, string>;
}) {
  const router = useRouter();
  const t = useTranslations("calendar.client");
  return (
    <select
      aria-label={t("label")}
      data-testid="calendar-client"
      value={value}
      onChange={(e) => router.push(hrefs[e.target.value] ?? hrefs[""])}
      // max-w-full + truncate: a select is as wide as its longest option, so one client with a
      // long name pushed the whole screen sideways on a phone (CI phone check, 18.11.2026).
      className="min-w-0 max-w-full truncate rounded-full border border-app-border-strong bg-white px-4 py-2 text-[13.5px] text-app-text-primary"
    >
      <option value="">{t("all")}</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id} dir="auto">
          {c.name}
        </option>
      ))}
    </select>
  );
}

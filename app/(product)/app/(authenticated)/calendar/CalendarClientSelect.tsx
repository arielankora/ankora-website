"use client";
import { useRouter } from "next/navigation";

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
  return (
    <select
      aria-label="לקוח"
      data-testid="calendar-client"
      value={value}
      onChange={(e) => router.push(hrefs[e.target.value] ?? hrefs[""])}
      className="rounded-full border border-app-border bg-white px-4 py-2 text-[13.5px] text-app-text-primary"
    >
      <option value="">כל הלקוחות</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

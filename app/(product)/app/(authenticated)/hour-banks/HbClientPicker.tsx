"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Option = { id: string; name: string };

// Spec 14.3's URL-state convention (also used by /app/time-entries's
// FilterBar): the selected client lives in ?clientId= so the page is
// shareable/bookmarkable per client.
export function HbClientPicker({ clients, current }: { clients: Option[]; current: string }) {
  const router = useRouter();
  const t = useTranslations("hourBanks.picker");

  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <label className="block text-xs font-medium text-app-text-secondary">{t("client")}</label>
      <select
        defaultValue={current}
        onChange={(e) => router.push(`/app/hour-banks?clientId=${e.target.value}`)}
        className="mt-1.5 w-full max-w-sm rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
      >
        <option value="">{t("placeholder")}</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id} dir="auto">
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";

export function ClientPicker({ clients, selected }: { clients: { id: string; name: string }[]; selected: string }) {
  const router = useRouter();
  return (
    <select
      aria-label="לקוח"
      value={selected}
      onChange={(e) => router.push(`/app/credentials?clientId=${encodeURIComponent(e.target.value)}`)}
      className="rounded-full border border-lineDark bg-white px-4 py-2 text-sm text-appNavy outline-none focus:border-gold"
    >
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

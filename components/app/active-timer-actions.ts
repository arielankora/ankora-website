"use server";
import { getCurrentUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getActiveTimers } from "@/lib/app-domain/time-entries";
import { summariseActiveTimers, type ActiveTimerSummary } from "./active-timer-summary";

/// The top bar pill and the sidebar counter ask this whether their clock
/// is still true (19.10.2026). It is the same read the layout makes, cut
/// down to what the pill shows, so a check costs one indexed query.
///
/// Never redirects: it runs in the background (focus, another tab, a
/// minute passing), and a background check must not move the person to
/// the login screen. A lost session answers `ok: false` and the pill
/// keeps what it has until the next real navigation handles the login.
export async function getActiveTimerSummaryAction(): Promise<
  { ok: true; summary: ActiveTimerSummary } | { ok: false }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  if (!can(user.role, "time_entry.create_self")) return { ok: true, summary: null };
  const rows = await getActiveTimers(user.id);
  return { ok: true, summary: summariseActiveTimers(rows) };
}

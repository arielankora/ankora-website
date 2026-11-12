import { redirect } from "next/navigation";
import { carryQuery } from "@/components/app/ViewTabs";
import { MONTHLY_REPORT_ANCHOR } from "../hours/tabs";

// 19.10.2026: the monthly report is a view of the hours screen now. This
// address is in the monthly emails and in clients' bookmarks, so it stays,
// and the month it points at comes along.
// 11.11.2026: the monthly tab is gone; the month's export and summary sit at
// the bottom of the hours tab, and this address scrolls straight to them.
export default async function PortalMonthlyRedirect(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = carryQuery(await props.searchParams, ["monthOffset"], {});
  redirect(`/app/portal/hours${query ? `?${query}` : ""}#${MONTHLY_REPORT_ANCHOR}`);
}

import { redirect } from "next/navigation";
import { carryQuery } from "@/components/app/ViewTabs";

// 19.10.2026: the monthly report is a view of the hours screen now. This
// address is in the monthly emails and in clients' bookmarks, so it stays,
// and the month it points at comes along.
export default async function PortalMonthlyRedirect(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(`/app/portal/hours?${carryQuery(await props.searchParams, ["monthOffset"], { view: "monthly" })}`);
}

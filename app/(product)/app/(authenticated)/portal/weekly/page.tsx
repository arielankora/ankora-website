import { redirect } from "next/navigation";
import { carryQuery } from "@/components/app/ViewTabs";

// 20.10.2026: the week by days is a view of the hours screen now. The
// address stays for bookmarks, and the week it points at comes along.
export default async function PortalWeeklyRedirect(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(`/app/portal/hours?${carryQuery(await props.searchParams, ["weekOffset"], { view: "weekly" })}`);
}

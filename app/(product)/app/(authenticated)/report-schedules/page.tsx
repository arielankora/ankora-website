import { redirect } from "next/navigation";
import { carryQuery } from "@/components/app/ViewTabs";

// 19.10.2026: scheduled reports are a tab of the reports screen now. The
// address stays so links keep working, and the chosen client comes along.
export default async function ReportSchedulesRedirect(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(`/app/reports?${carryQuery(await props.searchParams, ["clientId"], { tab: "schedules" })}`);
}

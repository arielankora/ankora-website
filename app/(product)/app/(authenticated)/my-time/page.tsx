import { redirect } from "next/navigation";
import { carryQuery } from "@/components/app/ViewTabs";

// 19.10.2026: "הזמן שלי" is a tab of the timer screen now. The address
// stays so bookmarks and links keep working, and the week comes along.
export default async function MyTimeRedirect(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(`/app/timer?${carryQuery(await props.searchParams, ["week"], { tab: "mine" })}`);
}

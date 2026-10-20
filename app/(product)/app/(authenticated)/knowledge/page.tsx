import { redirect } from "next/navigation";
import { parseReviewFilters, reviewFiltersHref } from "@/lib/knowledge-review-filters";

// 20.10.2026: the review screen is the tab "ידע מהחילוץ" of "אישורים". The
// address stays for links in emails, notifications and bookmarks, and
// carries its filters, and only them, to the tab.
export default async function KnowledgeRedirect(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(reviewFiltersHref(parseReviewFilters(await props.searchParams)));
}

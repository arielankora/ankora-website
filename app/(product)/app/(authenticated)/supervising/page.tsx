import { redirect } from "next/navigation";

// "בפיקוח שלי" was its own screen from tasks phase 2 until 15.10.2026,
// when Ariel removed it: the tasks screen's "בפיקוח" option shows the
// same work, with the same filters as everything else on that screen.
//
// The address stays, as a redirect, because it was in the nav for three
// weeks and lives on in bookmarks and old messages. It lands on what was
// the top of the old screen: the work waiting on this person's sign-off.
// On the list, said out loud: the board is the default since 10.11.2026
// and ignores a status filter (lib/tasks-view.ts).
export default function SupervisingPage(): never {
  redirect("/app/tasks?mine=supervising&status=PENDING_APPROVAL&view=list");
}

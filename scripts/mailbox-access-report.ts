// Before the per-mailbox access goes live (27.11.2026): for each connected
// client mailbox, who keeps it by role, who is on its list, and who could
// read it until now (by seeing the client) and will lose it. Read only.
//
//   DATABASE_URL="postgresql://..." npx tsx --conditions=react-server scripts/mailbox-access-report.ts
//
// --conditions=react-server: the domain modules import "server-only",
// which only resolves to an empty module under that condition.
import { prisma } from "../lib/prisma";
import { accessLossReport } from "../lib/client-mailbox/access";

async function main() {
  const rows = await accessLossReport();
  if (rows.length === 0) {
    console.log("אין תיבות לקוח מחוברות.");
    return;
  }
  for (const r of rows) {
    console.log(`${r.client}: ${r.mailbox}`);
    console.log(`  נשארים לפי תפקיד: מנהלי המערכת${r.keepByRole.length ? `, ${r.keepByRole.join(", ")}` : ""}`);
    console.log(`  ברשימה: ${r.onList.length ? r.onList.join(", ") : "אין"}`);
    console.log(`  מאבדים גישה: ${r.loses.length ? r.loses.join(", ") : "אף אחד"}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

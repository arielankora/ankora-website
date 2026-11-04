// One-time cleanup (4.11.2026): closes hour-bank alert events that were
// left open before alerts started closing on their own when a new cycle
// is opened or hours are loaded. The rules are findAndCloseStaleAlerts in
// lib/app-domain/alert-closure.ts.
//
// A dry run by default: it prints how many events would close, and why,
// and changes nothing. Only --apply writes.
//
//   DATABASE_URL="postgresql://..." npx tsx --conditions=react-server scripts/close-stale-alerts.ts
//   DATABASE_URL="postgresql://..." npx tsx --conditions=react-server scripts/close-stale-alerts.ts --apply
//
// --conditions=react-server: the domain modules import "server-only",
// which only resolves to an empty module under that condition.
import { prisma } from "../lib/prisma";
import { findAndCloseStaleAlerts } from "../lib/app-domain/alert-closure";
import { readOnlyUtilization } from "../lib/app-domain/hour-banks";

const LABELS = {
  NEW_CYCLE: "נפתח מחזור חדש",
  HOURS_LOADED: "נטענו שעות לבנק (נטענה חבילה חדשה)",
  BELOW_THRESHOLD: "הניצול ירד מתחת לסף",
  SUPERSEDED: "פתוחה לצד התראה על סף גבוה יותר",
} as const;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  if (apply && args.includes("--dry-run")) throw new Error("--apply and --dry-run together: choose one.");

  const result = await findAndCloseStaleAlerts(prisma, readOnlyUtilization, { apply });
  const total = Object.values(result.toClose).reduce((n, ids) => n + ids.length, 0);

  console.log(apply ? "מצב: הרצה אמיתית (--apply)" : "מצב: הרצת ניסיון, שום דבר לא משתנה");
  console.log(`התראות פתוחות כעת: ${result.openBefore}`);
  for (const [kind, ids] of Object.entries(result.toClose)) {
    console.log(`  ${LABELS[kind as keyof typeof LABELS]}: ${ids.length}`);
  }
  console.log(`  בנק חסר או מחוק (לא נסגרות): ${result.skippedBankMissing.length}`);
  console.log(apply ? `נסגרו: ${total}` : `ייסגרו: ${total}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

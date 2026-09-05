// Shared setup for integration tests that hit a real Postgres database.
//
// These tests need the generated Prisma Client (`npx prisma generate`)
// and a reachable DATABASE_URL - point it at a throwaway local/dev
// database, never at Production. A convenient local option:
//
//   npm run db:dev            # starts the embedded dev Postgres
//   npx prisma migrate deploy # applies prisma/migrations/*
//   DATABASE_URL="postgresql://ankora:ankora_dev_only@127.0.0.1:55432/ankora_dev" npm run test
//
// This file only truncates tables between tests - it never creates the
// schema itself, so migrations must already be applied before running.
import { afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

const TABLES = [
  "audit_events",
  // Phase 4 tables truncate before the Phase 3 tables they (loosely)
  // reference - email_deliveries -> alert_events -> alert_rules -> clients.
  // alert_events.hourBankId is a plain column (no FK - see ADR 11.3), so
  // it does not need to precede hour_banks below.
  "email_deliveries",
  // Phase 6 tables - report_runs (child) before report_schedules
  // (parent); email_deliveries above already references report_runs via
  // reportRunId (nullable, onDelete: SetNull) so it's truncated first.
  "report_runs",
  "report_schedules",
  "alert_events",
  "alert_rules",
  // Phase 3 tables truncate before the Phase 1/2 tables they reference.
  "hour_bank_adjustments",
  "hour_banks",
  "billing_policies",
  // Phase 2 tables truncate before the Phase 1 tables they reference.
  "time_entry_revisions",
  "time_entries",
  "tasks",
  "user_client_access",
  "client_users",
  "categories",
  "clients",
  "password_reset_tokens",
  "users",
];

export async function resetDb() {
  await prisma.$transaction(TABLES.map((t) => prisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE;`)));
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

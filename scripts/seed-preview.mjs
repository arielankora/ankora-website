#!/usr/bin/env node
// Runs prisma/seed.ts automatically during `npm run build`, but ONLY for
// Vercel Preview deployments (VERCEL_ENV === "preview"). This is safe
// specifically because the Preview environment has its own isolated Neon
// database branch (see README "Preview database isolation") - Production
// and local/dev builds never set VERCEL_ENV=preview, so this is a no-op
// for them. This matches prisma/seed.ts's own rule that demo fixtures
// must never reach Production: previously Preview and Production shared
// one database, so auto-seeding was unsafe; now that Preview branches
// off into its own copy, auto-seeding only the Preview branch is safe.
import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "preview") {
  console.log(
    "[seed-preview] Skipping demo seed (VERCEL_ENV is " +
      JSON.stringify(process.env.VERCEL_ENV ?? null) +
      ", not \"preview\")."
  );
  process.exit(0);
}

console.log(
  "[seed-preview] VERCEL_ENV=preview - seeding demo fixtures into this " +
    "deployment's isolated database branch..."
);
const result = spawnSync("npx", ["tsx", "prisma/seed.ts"], {
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 0);

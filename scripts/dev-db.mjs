// Starts/stops an embedded local Postgres for development and tests.
// NOT used in production - Production uses the real DATABASE_URL from
// Vercel Postgres, set as an env var in the Vercel dashboard.
import EmbeddedPostgres from "embedded-postgres";

const pg = new EmbeddedPostgres({
  databaseDir: process.env.PG_DATA_DIR || "/tmp/ankora-dev-postgres",
  user: "ankora",
  password: "ankora_dev_only",
  port: 55432,
  persistent: true,
});

const action = process.argv[2] || "start";

if (action === "start") {
  await pg.initialise().catch(() => {}); // no-op if already initialised
  await pg.start();
  try {
    await pg.createDatabase("ankora_dev");
  } catch {
    // already exists
  }
  console.log("Local dev Postgres ready on port 55432, db=ankora_dev");
} else if (action === "stop") {
  await pg.start().catch(() => {});
  await pg.stop();
  console.log("Local dev Postgres stopped");
}

import { rewrapVaultKeys } from "@/lib/app-domain/vault-rewrap";
import { runCron } from "@/lib/cron-run";

// Moves credential rows onto the vault key that currently writes. A no-op
// on every night that follows no rotation. Its own cron, not folded into
// another, so it can be run by hand from the Vercel dashboard (Settings,
// Cron Jobs, Run) the moment a key is rotated after a suspected leak,
// without also sending the morning digest or the nightly export.
// Same CRON_SECRET protection as the other cron routes.
export async function GET(request: Request) {
  return runCron("vault-rewrap", request, async (step) => ({ ...(await step("rewrap", () => rewrapVaultKeys())) }));
}

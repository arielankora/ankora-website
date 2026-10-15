import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { rewrapVaultKeys } from "@/lib/app-domain/vault-rewrap";

// Moves credential rows onto the vault key that currently writes. A no-op
// on every night that follows no rotation. Its own cron, not folded into
// another, so it can be run by hand from the Vercel dashboard (Settings,
// Cron Jobs, Run) the moment a key is rotated after a suspected leak,
// without also sending the morning digest or the nightly export.
// Same CRON_SECRET protection as the other cron routes.
export async function GET(request: Request) {
  const authorized = authorizeCronRequest(request);
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  }
  try {
    const result = await rewrapVaultKeys();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("vault-rewrap cron failed:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

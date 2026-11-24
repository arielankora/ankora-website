import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/app-auth/session";
import { CONNECT_COOKIE, completeConnect, readIntent, type ConnectResult } from "@/lib/comms/self-connect";

const PAGE = "/app/whatsapp-poc/connect";

/// Where Unipile's Hosted Auth sends the employee back (step 1 of
/// lib/comms/self-connect.ts): ?account_id=...&provider=... on success,
/// ?error_type=... on a failure that needs a new link.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/app/login", url));

  const jar = await cookies();
  const intent = readIntent(jar.get(CONNECT_COOKIE)?.value);
  let result: ConnectResult;
  try {
    result = await completeConnect(user, intent, {
      accountId: url.searchParams.get("account_id"),
      errorType: url.searchParams.get("error_type"),
    });
  } catch (err) {
    console.error("self-connect: the way back failed", err);
    result = "failed";
  }
  const response = NextResponse.redirect(new URL(`${PAGE}?result=${result}`, url));
  response.cookies.delete({ name: CONNECT_COOKIE, path: PAGE });
  return response;
}

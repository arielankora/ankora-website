import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/app-auth/session";
import { MAIL_CONNECT_COOKIE, completeMailConnect, readMailIntent, type MailConnectResult } from "@/lib/mail-scan/channels";

const PAGE = "/app/whatsapp-poc/mail/connect";

/// Where Unipile's Hosted Auth sends the employee back (lib/mail-scan/
/// channels.ts): ?account_id=... on success, ?error_type=... on a failure
/// that needs a new link.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/app/login", url));

  const jar = await cookies();
  const intent = readMailIntent(jar.get(MAIL_CONNECT_COOKIE)?.value);
  let result: MailConnectResult;
  try {
    result = (
      await completeMailConnect(user, intent, {
        accountId: url.searchParams.get("account_id"),
        errorType: url.searchParams.get("error_type"),
      })
    ).result;
  } catch (err) {
    console.error("mail-scan: the way back failed", err);
    result = "failed";
  }
  const response = NextResponse.redirect(new URL(`${PAGE}?result=${result}`, url));
  response.cookies.delete({ name: MAIL_CONNECT_COOKIE, path: PAGE });
  return response;
}

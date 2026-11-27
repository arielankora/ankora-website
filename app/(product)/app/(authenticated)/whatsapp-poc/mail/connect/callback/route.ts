import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/app-auth/session";
import { prisma } from "@/lib/prisma";
import { CHANNEL_PERSON_WHERE } from "@/lib/comms/channel-people";
import {
  MAIL_CONNECT_COOKIE,
  completeMailConnect,
  readMailIntent,
  type MailConnectFailure,
  type MailConnectResult,
} from "@/lib/mail-scan/channels";
import { providerErrorOf } from "@/lib/mail-scan/connect-errors";

const PAGE = "/app/whatsapp-poc/mail/connect";

/// Where Unipile's Hosted Auth sends the employee back (lib/mail-scan/
/// channels.ts): ?account_id=...&state=... on success, ?error_type=... on a
/// failure that needs a new link.
///
/// The signed intent comes back in the cookie set when the button was
/// pressed, or, for a link made through the connector (manage_connected_
/// mailbox), in Unipile's `state`. Either is signed and short-lived, and
/// names the person it is for: someone else signed in here is refused.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const intent = readMailIntent(jar.get(MAIL_CONNECT_COOKIE)?.value) ?? readMailIntent(url.searchParams.get("state") ?? undefined);
  const signedIn = await getCurrentUser();
  const user =
    signedIn ??
    (intent ? await prisma.user.findFirst({ where: { ...CHANNEL_PERSON_WHERE, id: intent.userId }, select: { id: true, role: true, name: true, email: true } }) : null);
  if (!user) return NextResponse.redirect(new URL("/app/login", url));

  // Unipile names a failure in error_type, error_title or error (as on the
  // client mailbox's way back, app/api/connections/mailbox/callback).
  const providerError = providerErrorOf(url.searchParams);
  let result: MailConnectResult;
  let failure: MailConnectFailure | "exception" | undefined;
  try {
    const done = await completeMailConnect(user, intent, {
      accountId: url.searchParams.get("account_id"),
      errorType: providerError,
    });
    result = done.result;
    failure = done.failure;
  } catch (err) {
    console.error("mail-scan: the way back failed", err);
    result = "failed";
    failure = "exception";
  }
  if (result !== "connected" && result !== "reconnected" && result !== "reused") {
    // Only the names of the parameters and Unipile's own error words: never
    // the state or an account's content.
    console.warn("mail-scan: connect did not complete", {
      result,
      failure: failure ?? null,
      providerError,
      params: [...new Set(url.searchParams.keys())].sort(),
      hasCookie: Boolean(jar.get(MAIL_CONNECT_COOKIE)),
    });
  }
  const target = new URL(PAGE, url);
  target.searchParams.set("result", result);
  if (result === "failed") target.searchParams.set("why", providerError ?? failure ?? "unknown");
  const response = NextResponse.redirect(target);
  response.cookies.delete({ name: MAIL_CONNECT_COOKIE, path: PAGE });
  return response;
}

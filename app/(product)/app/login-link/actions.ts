"use server";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { requestLoginLink } from "@/lib/app-auth/login-link";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";

// Portal phase 0. Same unauthenticated-endpoint reasoning as
// forgot-password/actions.ts: every request that matches a real client
// writes a row and sends mail from Ankora's own domain, so it needs a
// ceiling before it is reachable. 5 per IP per 15 minutes - a client who
// mistypes their address twice never notices.
const LINK_REQUEST_LIMIT = 5;
const LINK_REQUEST_WINDOW_MS = 15 * 60 * 1000;

// A second, tighter ceiling on CONSUMING links: the token is 32 random
// bytes and cannot be guessed, but an unbounded consume endpoint is still
// free load, and every attempt hits the database.
const LINK_CONSUME_LIMIT = 10;
const LINK_CONSUME_WINDOW_MS = 15 * 60 * 1000;

export type RequestLinkState = { submitted?: boolean; devLink?: string };

export async function requestLoginLinkAction(
  _prev: RequestLinkState | undefined,
  formData: FormData
): Promise<RequestLinkState> {
  const ip = clientIpFrom(await headers());
  if (!(await checkRateLimit(`login-link:${ip}`, LINK_REQUEST_LIMIT, LINK_REQUEST_WINDOW_MS)).allowed) {
    // The throttled answer is identical to the normal one, for the same
    // reason the message never says whether the address exists.
    return { submitted: true };
  }

  const { devToken } = await requestLoginLink(String(formData.get("identifier") || ""));

  return {
    submitted: true,
    devLink: devToken ? `/app/login-link?token=${devToken}` : undefined,
  };
}

/// Consumes the token and starts a session. Reached by POST only: the
/// emailed page auto-submits this form, so a mail scanner or link
/// preview that merely GETs the URL cannot burn the client's one use.
export async function consumeLoginLinkAction(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const ip = clientIpFrom(await headers());
  if (!(await checkRateLimit(`login-link-consume:${ip}`, LINK_CONSUME_LIMIT, LINK_CONSUME_WINDOW_MS)).allowed) {
    return { error: "הקישור אינו תקין או שפג תוקפו." };
  }

  try {
    await signIn("login-link", {
      token: String(formData.get("token") || ""),
      // A client's home is the portal, and a link is only ever issued to
      // a CLIENT_USER - so there is no callbackUrl to carry here, and
      // nothing a caller could point this at.
      redirectTo: "/app/portal",
    });
    return {};
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "הקישור אינו תקין או שפג תוקפו." };
    }
    throw err;
  }
}

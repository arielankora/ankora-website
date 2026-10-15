"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { requestContext } from "@/lib/app-auth/audit";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { AgreementError, signConfidentiality } from "@/lib/app-domain/agreements";
import type { AgreementSignState } from "@/components/app/agreements/AgreementSignForm";

// A server action, so Next's own origin check applies. The rate limit is
// for the name check: it answers "this is not your name" with the name
// on the account, which is harmless to the account holder but should not
// be a free oracle. 10 tries per IP per 15 minutes is far beyond anyone
// fixing a typo.
const SIGN_LIMIT = 10;
const SIGN_WINDOW_MS = 15 * 60 * 1000;

export async function signConfidentialityAction(
  _prev: AgreementSignState | undefined,
  formData: FormData
): Promise<AgreementSignState> {
  const user = await requireUser();

  const ip = clientIpFrom(await headers());
  if (!(await checkRateLimit(`agreement-sign:${ip}`, SIGN_LIMIT, SIGN_WINDOW_MS)).allowed) {
    return { error: "יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות." };
  }

  const ctx = await requestContext();
  try {
    await signConfidentiality(user, {
      signedName: String(formData.get("signedName") || ""),
      consent: formData.get("consent") === "on",
      version: String(formData.get("version") || ""),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  } catch (err) {
    if (err instanceof AgreementError) return { error: err.message };
    if (err instanceof ForbiddenError) return { error: "אין צורך בחתימה על המסמך הזה בחשבון הזה." };
    throw err;
  }

  // Outside the try: redirect() works by throwing.
  redirect("/app");
}

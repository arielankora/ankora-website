"use server";
import { headers } from "next/headers";
import { requestContext } from "@/lib/app-auth/audit";
import { checkRateLimit, clientIpFrom } from "@/lib/rate-limit";
import { AgreementError, signWithLink } from "@/lib/app-domain/agreements";
import type { AgreementSignState } from "@/components/app/agreements/AgreementSignForm";

// Unauthenticated: the token in the form is the only credential. Same
// budget as the in-app form, under its own key so the two never share it.
const SIGN_LIMIT = 10;
const SIGN_WINDOW_MS = 15 * 60 * 1000;

export async function signWithLinkAction(
  _prev: AgreementSignState | undefined,
  formData: FormData
): Promise<AgreementSignState> {
  const ip = clientIpFrom(await headers());
  if (!(await checkRateLimit(`agreement-link-sign:${ip}`, SIGN_LIMIT, SIGN_WINDOW_MS)).allowed) {
    return { error: "יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות." };
  }

  const ctx = await requestContext();
  try {
    await signWithLink(String(formData.get("token") || ""), {
      signedName: String(formData.get("signedName") || ""),
      consent: formData.get("consent") === "on",
      version: String(formData.get("version") || ""),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  } catch (err) {
    if (err instanceof AgreementError) return { error: err.message };
    throw err;
  }
  return { done: true };
}

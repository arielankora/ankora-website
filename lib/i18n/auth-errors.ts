import "server-only";
import { getTranslations } from "next-intl/server";
import { PasskeyError } from "@/lib/app-auth/passkeys";
import { SecondFactorError } from "@/lib/app-auth/second-factor";
import { PasskeyRequiredError, StepUpFailedError, StepUpLockedError } from "@/lib/app-auth/step-up";

// ADR 0006: the sign-in, passkey and identity-check refusals, in the
// reader's language. Each error class carries a code beside its Hebrew
// message; this turns the code into the sentence. Anything that is not
// one of these errors returns null, and the caller decides what a fault
// looks like, exactly as it did before.
//
// Route handlers send the sentence in their JSON `message`, and the
// browser shows it as it comes (components/app/vault/webauthn-client.ts).
export async function authErrorText(err: unknown): Promise<string | null> {
  const t = await getTranslations("auth.errors");
  if (err instanceof SecondFactorError) {
    const code = err.code;
    return code.startsWith("passkey.")
      ? t(`passkey.${code.slice("passkey.".length) as PasskeyError["code"]}`)
      : t(`secondFactor.${code as Exclude<typeof code, `passkey.${string}`>}`);
  }
  if (err instanceof PasskeyError) return t(`passkey.${err.code}`);
  if (err instanceof StepUpLockedError || err instanceof StepUpFailedError || err instanceof PasskeyRequiredError) {
    return t(`stepUp.${err.code}`);
  }
  return null;
}

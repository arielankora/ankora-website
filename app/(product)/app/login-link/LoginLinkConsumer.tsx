"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { consumeLoginLinkAction } from "./actions";
import { SecondFactorStep } from "../login/SecondFactorStep";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-5 min-h-[50px] w-full rounded-full bg-app-accent text-[15px] font-medium text-app-text-primary disabled:opacity-50"
    >
      {pending ? "מתחבר…" : "כניסה לפורטל"}
    </button>
  );
}

// Portal phase 0. The token arrives in the URL, but it is spent by a POST
// the page submits for itself. Two reasons, both real: mail scanners and
// chat link-previews fetch URLs with GET and would otherwise burn a
// single-use link before the client ever clicked it, and a token consumed
// during a GET render would have to set cookies while rendering, which
// Next does not allow. The visible button is the fallback for anyone with
// JavaScript off, and the only thing they see if the auto-submit is
// blocked.
export function LoginLinkConsumer({ token }: { token: string }) {
  const [state, formAction] = useFormState(consumeLoginLinkAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current || !token) return;
    submitted.current = true;
    formRef.current?.requestSubmit();
  }, [token]);

  // The link was good, and this client asked for a passkey at every
  // sign-in.
  if (state?.step && state.token) {
    return (
      <SecondFactorStep
        step={state.step}
        token={state.token}
        callbackUrl={state.callbackUrl ?? "/app/portal"}
        restartHref="/app/login-link/request"
      />
    );
  }

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="token" value={token} />

      {state?.error ? (
        <>
          <p className="rounded-[10px] border border-app-error/30 bg-app-error-soft px-3 py-2.5 text-xs text-app-error">
            {state.error}
          </p>
          <Link
            href="/app/login-link/request"
            className="mt-5 flex min-h-[50px] w-full items-center justify-center rounded-full bg-app-accent text-[15px] font-medium text-app-text-primary"
          >
            שליחת קישור חדש
          </Link>
        </>
      ) : (
        <>
          <p className="text-[13.5px] text-app-text-secondary">רגע אחד, מכניסים אותך לפורטל.</p>
          <Submit />
        </>
      )}
    </form>
  );
}

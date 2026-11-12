import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/app-auth/session";
import { CONFIDENTIALITY_SIGN_PATH, confidentialitySignatures, mustSignConfidentiality } from "@/lib/agreements";
import { getClient } from "@/lib/mcp/oauth/store";
import { findMatchingRedirectUri } from "@/lib/mcp/oauth/redirect";

// Phase 15 (MCP OAuth, docs/adr/0005): the consent screen.
//
// This is the only place a human is in the loop, and it is what makes the
// whole design safe: holding a client_id lets anyone START an
// authorization, but only someone who can sign in to Ankora can finish
// one.
//
// It lives outside the (authenticated) route group on purpose - no
// sidebar, no navigation, nothing to click away to. A consent screen
// should show one decision.
//
// Sign-in is the EXISTING Auth.js flow. If there is no session we send the
// user to /app/login with a callbackUrl back to this exact URL, which
// actions.ts validates before honouring.

export const dynamic = "force-dynamic";

type Params = {
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
  resource?: string;
};

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-xl font-semibold text-app-text-primary">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-app-text-secondary">{detail}</p>
    </main>
  );
}

export default async function ConsentPage(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  const t = await getTranslations("auth.consent");

  const clientId = sp.client_id ?? "";
  const redirectUri = sp.redirect_uri ?? "";
  const codeChallenge = sp.code_challenge ?? "";
  const codeChallengeMethod = sp.code_challenge_method ?? "";

  // Re-validated here rather than trusted from the authorize endpoint.
  // This page is reachable by URL, so it cannot assume it was reached
  // through the redirect that checked these.
  const client = clientId ? await getClient(clientId) : null;
  if (!client || !redirectUri || !codeChallenge || !codeChallengeMethod) {
    return (
      <Problem
        title={t("invalidRequestTitle")}
        detail={t("invalidRequestDetail")}
      />
    );
  }
  if (!findMatchingRedirectUri(redirectUri, client.redirectUris)) {
    return (
      <Problem
        title={t("invalidRedirectTitle")}
        detail={t("invalidRedirectDetail")}
      />
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    const here = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]);
    redirect(`/app/login?callbackUrl=${encodeURIComponent(`/app/oauth/consent?${here.toString()}`)}`);
  }

  // Connecting Claude hands it the same data the app shows, so the same
  // confidentiality gate applies here as in the app's own layout.
  if (user.role !== "CLIENT_USER" && mustSignConfidentiality(user.role, await confidentialitySignatures(user.id))) {
    redirect(CONFIDENTIALITY_SIGN_PATH);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-xl font-semibold text-app-text-primary">{t("title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-app-text-secondary">
        {t.rich("signedInAs", {
          name: () => (
            <strong dir="auto" className="font-medium text-app-text-primary">
              {user.name}
            </strong>
          ),
          email: user.email,
        })}
      </p>

      <div className="mt-6 rounded-lg border border-app-border bg-app-surface-page p-4 text-sm leading-relaxed text-app-text-primary">
        <p className="font-medium text-app-text-primary">{t("canDo")}</p>
        {user.role === "CLIENT_USER" ? (
          // A portal user connects the portal connector (/api/mcp/portal),
          // which reads what their portal shows and answers decisions -
          // nothing about timers or other clients applies to them.
          <ul className="mt-2 list-disc space-y-1 pe-5">
            <li>{t("portal.tasks")}</li>
            <li>{t("portal.reports")}</li>
            <li>{t("portal.decisions")}</li>
          </ul>
        ) : (
          <ul className="mt-2 list-disc space-y-1 pe-5">
            <li>{t("staff.clients")}</li>
            <li>{t("staff.entries")}</li>
            <li>{t("staff.timer")}</li>
          </ul>
        )}
        <p className="mt-3 text-app-text-secondary">{t("permissions")}</p>
      </div>

      <form method="POST" action="/api/mcp/oauth/consent" className="mt-6 flex gap-3">
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="code_challenge" value={codeChallenge} />
        <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />
        <input type="hidden" name="scope" value={sp.scope ?? ""} />
        <input type="hidden" name="state" value={sp.state ?? ""} />
        <input type="hidden" name="resource" value={sp.resource ?? ""} />
        <button
          type="submit"
          name="decision"
          value="approve"
          className="flex-1 rounded-md bg-app-surface-nav px-4 py-2.5 text-sm font-medium text-cream transition hover:opacity-90"
        >
          {t("approve")}
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className="flex-1 rounded-md border border-app-border-strong px-4 py-2.5 text-sm font-medium text-app-text-primary transition hover:bg-app-surface-sunken"
        >
          {t("deny")}
        </button>
      </form>
    </main>
  );
}

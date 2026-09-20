import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/app-auth/session";
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
      <h1 className="text-xl font-semibold text-navy">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-navy/70">{detail}</p>
    </main>
  );
}

export default async function ConsentPage(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;

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
        title="Invalid connection request"
        detail="This link is incomplete or has expired. Start the connection again from Claude."
      />
    );
  }
  if (!findMatchingRedirectUri(redirectUri, client.redirectUris)) {
    return (
      <Problem
        title="Invalid redirect address"
        detail="The address this application asked to be returned to is not one it registered. Nothing was shared."
      />
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    const here = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]);
    redirect(`/app/login?callbackUrl=${encodeURIComponent(`/app/oauth/consent?${here.toString()}`)}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6" dir="rtl">
      <h1 className="text-xl font-semibold text-navy">חיבור Claude לאנקורה</h1>
      <p className="mt-2 text-sm leading-relaxed text-navy/70">
        אתה מחובר כ־<strong className="font-medium text-navy">{user.name}</strong> ({user.email}).
      </p>

      <div className="mt-6 rounded-lg border border-navy/10 bg-paper p-4 text-sm leading-relaxed text-navy/80">
        <p className="font-medium text-navy">מה Claude יוכל לעשות</p>
        <ul className="mt-2 list-disc space-y-1 pe-5">
          <li>לראות את הלקוחות והקטגוריות שאתה רשאי לדווח עליהם</li>
          <li>לקרוא את דיווחי הזמן שלך</li>
          <li>להפעיל ולעצור טיימר, ולרשום זמן בשמך</li>
        </ul>
        <p className="mt-3 text-navy/60">
          Claude פועל בהרשאות שלך בלבד — בדיוק מה שאתה רואה במערכת, לא יותר. מחיקה אינה אפשרית דרך החיבור
          הזה.
        </p>
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
          className="flex-1 rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-paper transition hover:opacity-90"
        >
          אישור חיבור
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className="flex-1 rounded-md border border-navy/20 px-4 py-2.5 text-sm font-medium text-navy transition hover:bg-navy/5"
        >
          ביטול
        </button>
      </form>
    </main>
  );
}

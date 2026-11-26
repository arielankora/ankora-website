import { getCurrentUser } from "@/lib/app-auth/session";
import { completeMailboxConnect, readMailboxIntent, type MailboxConnectResult } from "@/lib/client-mailbox/connect";

// Where Unipile's Hosted Auth sends the browser back after a client's
// mailbox is connected (lib/client-mailbox/connect.ts): ?account_id=...
// &state=... on success, ?error_title=... on a failure. The state is the
// signed intent made when the link was created. The link is often opened by
// the client, in a browser where nobody is signed in to Ankora: they get a
// short page saying it worked; someone signed in goes back to the screen.

export const dynamic = "force-dynamic";

const PAGE_TEXT: Record<MailboxConnectResult, { he: string; en: string }> = {
  connected: { he: "התיבה חוברה לאנקורה. אפשר לסגור את החלון.", en: "The mailbox is connected to Ankora. You can close this window." },
  reconnected: { he: "התיבה חוברה מחדש. אפשר לסגור את החלון.", en: "The mailbox is reconnected. You can close this window." },
  expired: { he: "הקישור פג או לא תקין. בקשו קישור חדש ממנהל התיק.", en: "The link has expired or is not valid. Ask your account manager for a new one." },
  failed: { he: "החיבור לא הושלם. נסו שוב, או בקשו קישור חדש.", en: "The connection was not completed. Try again, or ask for a new link." },
  wrongProvider: { he: "החשבון שחובר אינו תיבת דואר. בקשו קישור חדש.", en: "The account connected is not a mailbox. Ask for a new link." },
  taken: { he: "התיבה הזו כבר מחוברת, או שהחיבור הגיע מקישור ישן. בקשו קישור חדש.", en: "This mailbox is already connected, or the link was an old one. Ask for a new link." },
};

function page(result: MailboxConnectResult): Response {
  const t = PAGE_TEXT[result];
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Ankora</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.6;color:#1a1a1a;background:#fff"><h1 style="font-size:1.25rem">אנקורה</h1><p>${t.he}</p><p dir="ltr" lang="en" style="color:#555">${t.en}</p></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const intent = readMailboxIntent(url.searchParams.get("state"));
  let outcome: { result: MailboxConnectResult; clientId: string | null };
  try {
    outcome = await completeMailboxConnect(intent, {
      accountId: url.searchParams.get("account_id"),
      error: url.searchParams.get("error_title") ?? url.searchParams.get("error_type") ?? url.searchParams.get("error"),
    });
  } catch (err) {
    console.error("mailbox connect: the way back failed", err);
    outcome = { result: "failed", clientId: intent?.clientId ?? null };
  }
  const user = await getCurrentUser().catch(() => null);
  if (user && user.role !== "CLIENT_USER" && outcome.clientId) {
    return Response.redirect(new URL(`/app/clients/${encodeURIComponent(outcome.clientId)}/connections?mailbox=${outcome.result}`, url.origin), 303);
  }
  return page(outcome.result);
}

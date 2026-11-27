"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { isProductionBuild } from "@/lib/env";
import { appBaseUrl } from "@/lib/email-templates";
import { DomainError } from "@/lib/domain-error";
import { canManageClients } from "@/lib/app-auth/permissions";
import { parseBlockTarget } from "@/lib/mail-scan/rules";
import {
  MAIL_CONNECT_COOKIE,
  MAIL_CONNECT_MINUTES,
  changeMailOwner,
  chooseMailboxKind,
  createMailConnectLink,
  decideMailBlock,
  requestMailBlock,
  revokeMailBlock,
  setMailExtractionAllowed,
  startScanning,
} from "@/lib/mail-scan/channels";

// "התיבות שלי" (27.11.2026): the actions of the connect page and the
// settings page. Plain forms: each action ends in a redirect whose query
// says what happened (?result= on the connect page, ?done= on the
// settings page), and a refusal comes back as its DomainError code
// (?err=mailScan.*), which the page puts in the reader's language.

const CONNECT = "/app/whatsapp-poc/mail/connect";
const SETUP = "/app/whatsapp-poc/mail/setup";

function refresh() {
  for (const p of [CONNECT, SETUP, "/app/whatsapp-poc"]) revalidatePath(p);
}

async function staff() {
  const user = await requireUser();
  if (user.role === "CLIENT_USER") redirect("/app");
  return user;
}

/// Runs a domain call; a refusal goes back to `page` with its code.
async function attempt(page: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (err instanceof DomainError && err.code) redirect(`${page}?err=${encodeURIComponent(err.code)}`);
    throw err;
  }
}

/// Step 1, or the reconnect of a mailbox: off to Unipile's Hosted Auth, with
/// a signed cookie that the way back must bring.
export async function startMailConnectAction(formData: FormData): Promise<void> {
  const user = await staff();
  const channelId = String(formData.get("channelId") || "") || null;
  let link: string;
  try {
    const made = await createMailConnectLink(user, { redirectUri: `${appBaseUrl()}${CONNECT}/callback`, channelId });
    const jar = await cookies();
    jar.set(MAIL_CONNECT_COOKIE, made.cookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProductionBuild(),
      path: CONNECT,
      maxAge: MAIL_CONNECT_MINUTES * 60,
    });
    link = made.link;
  } catch (err) {
    if (err instanceof DomainError && err.code?.startsWith("mailScan.")) redirect(`${CONNECT}?err=${encodeURIComponent(err.code)}`);
    console.error("mail-scan: could not create the link", err);
    redirect(`${CONNECT}?result=link-failed`);
  }
  redirect(link);
}

/// Step 2: "של מי התיבה".
export async function chooseKindAction(formData: FormData): Promise<void> {
  const user = await staff();
  const channelId = String(formData.get("channelId") || "");
  const kind = formData.get("kind") === "CLIENT" ? "CLIENT" : "ANKORA";
  const clientId = String(formData.get("clientId") || "");
  if (kind === "CLIENT" && !clientId) redirect(`${CONNECT}?err=mailScan.clientNotYours`);
  await attempt(CONNECT, () => chooseMailboxKind(user, channelId, kind === "CLIENT" ? { kind, clientId } : { kind }));
  refresh();
  redirect(`${CONNECT}?result=kindSaved`);
}

/// The marks of "מה לא לקרוא": the senders ticked, and an address or a
/// domain typed by hand. Values are "ADDRESS|<address>|<name>" or
/// "DOMAIN|<domain>|<name>".
export async function markSendersAction(formData: FormData): Promise<void> {
  const user = await staff();
  const channelId = String(formData.get("channelId") || "");
  const back = String(formData.get("back") || "") === "setup" ? SETUP : CONNECT;
  const targets: Array<{ kind: "ADDRESS" | "DOMAIN"; value: string; label: string | null }> = [];
  for (const raw of formData.getAll("block").map(String).slice(0, 200)) {
    const [kind, value, ...rest] = raw.split("|");
    const parsed = value ? parseBlockTarget(value) : null;
    if (!parsed || (kind !== "ADDRESS" && kind !== "DOMAIN")) continue;
    const target = kind === "DOMAIN" && parsed.kind === "ADDRESS" ? parseBlockTarget(parsed.value.split("@")[1]) : parsed;
    if (target) targets.push({ ...target, label: rest.join("|") || null });
  }
  const typed = String(formData.get("manual") || "").trim();
  if (typed) {
    const parsed = parseBlockTarget(typed);
    if (!parsed) redirect(`${back}?${back === SETUP ? "done" : "result"}=badTarget`);
    targets.push({ ...parsed, label: null });
  }
  await attempt(back, async () => {
    for (const t of targets) await requestMailBlock(user, { channelId, ...t });
  });
  refresh();
  if (back === SETUP) redirect(`${SETUP}?done=${!targets.length ? "noneMarked" : canManageClients(user.role) ? "added" : "requested"}`);
  redirect(`${CONNECT}?result=${targets.length ? "marked" : "noneMarked"}&count=${targets.length}`);
}

/// "הפעלת סריקה".
export async function startScanAction(formData: FormData): Promise<void> {
  const user = await staff();
  await attempt(CONNECT, () => startScanning(user, String(formData.get("channelId") || "")));
  refresh();
  redirect(`${CONNECT}?result=active`);
}

export async function decideMailBlockAction(formData: FormData): Promise<void> {
  const user = await staff();
  const approve = formData.get("decision") === "approve";
  await attempt(SETUP, () => decideMailBlock(user, String(formData.get("blockId") || ""), approve));
  refresh();
  redirect(`${SETUP}?done=${approve ? "approved" : "rejected"}`);
}

export async function revokeMailBlockAction(formData: FormData): Promise<void> {
  const user = await staff();
  await attempt(SETUP, () => revokeMailBlock(user, String(formData.get("blockId") || "")));
  refresh();
  redirect(`${SETUP}?done=revoked`);
}

export async function setMailExtractionAction(formData: FormData): Promise<void> {
  const user = await staff();
  await attempt(SETUP, () => setMailExtractionAllowed(user, String(formData.get("channelId") || ""), formData.get("extractionAllowed") === "on"));
  refresh();
  redirect(`${SETUP}?done=extraction`);
}

export async function changeMailOwnerAction(formData: FormData): Promise<void> {
  const user = await staff();
  await attempt(SETUP, () => changeMailOwner(user, String(formData.get("channelId") || ""), String(formData.get("ownerUserId") || "")));
  refresh();
  redirect(`${SETUP}?done=owner`);
}

"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { canManageClients } from "@/lib/app-auth/permissions";
import { commsAccess } from "@/lib/comms/access";
import { normalizePhone } from "@/lib/contact-normalize";
import { nextExcludedViewers } from "@/lib/comms/visibility";
import { readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { BlockError, backfillChannel, decideBlock, requestBlock, revokeBlock, startStoring } from "@/lib/comms/whatsapp-store";
import { transcribeRecording } from "@/lib/comms/call-store";
import { importManualRecordings } from "@/lib/comms/manual-import";
import { afterResponse } from "@/lib/after-response";
import { CHANNEL_PERSON_WHERE, ineligibleChannelPeople, personLabel } from "@/lib/comms/channel-people";
import { prisma } from "@/lib/prisma";

export type SetupState = { error?: string; ok?: string };

const PATHS = ["/app/whatsapp-poc", "/app/whatsapp-poc/setup"];
function refresh() {
  for (const p of PATHS) revalidatePath(p);
}

async function gate() {
  const user = await requireUser();
  const access = await commsAccess(user);
  if (!access.allowed && !canManageClients(user.role)) return { user, access, error: "אין הרשאה." as const };
  return { user, access, error: null };
}

/// Connect a WhatsApp number (a Unipile account) as a channel: whose it is,
/// and who must never see its conversations. A manager may connect a number
/// for someone else; anyone else, only as their own.
export async function connectChannelAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const user = await requireUser();
  if (user.role === "CLIENT_USER") return { error: "אין הרשאה." };
  const manager = canManageClients(user.role);
  const accountId = String(formData.get("accountId") || "").trim();
  if (!/^acc_[A-Za-z0-9]+$/.test(accountId)) return { error: "מזהה חשבון לא תקין (acc_...)." };
  const ownerUserId = manager ? String(formData.get("ownerUserId") || user.id) : user.id;
  // The owner sees every conversation on the number, so it has to be someone
  // who can sign in (lib/comms/channel-people.ts).
  const owner = await prisma.user.findFirst({ where: { ...CHANNEL_PERSON_WHERE, id: ownerUserId }, select: { id: true } });
  if (!owner) return { error: "אפשר לבחור כבעלים רק משתמש פעיל במערכת." };
  if (await prisma.commsChannel.findUnique({ where: { accountId } })) return { error: "המספר הזה כבר מחובר." };
  const excluded = [...new Set(formData.getAll("excluded").map(String).filter((id) => id && id !== ownerUserId))];
  if ((await ineligibleChannelPeople(excluded)).length > 0) {
    return { error: "ברשימת \"מי לא יראה\" אפשר לסמן רק משתמשים פעילים במערכת." };
  }
  const channel = await prisma.commsChannel.create({
    data: { accountId, ownerUserId, excludedViewerIds: excluded },
  });
  await recordAudit({
    actorId: user.id,
    action: "comms_channel.connected",
    entityType: "CommsChannel",
    entityId: channel.id,
    after: { ownerUserId, excludedViewerIds: channel.excludedViewerIds },
  });
  refresh();
  return { ok: "המספר מחובר. עכשיו מסמנים מה לא לשמור." };
}

/// Edit "לא רואים שיחות מהמספר" of a connected number (Ariel, 5.11.2026).
/// The owner or a manager may edit it. Someone who is on the list cannot take
/// themselves off it: a manager the owner kept out stays out until the owner
/// says otherwise.
export async function updateExcludedViewersAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const user = await requireUser();
  if (user.role === "CLIENT_USER") return { error: "אין הרשאה." };
  const channel = await prisma.commsChannel.findUnique({ where: { id: String(formData.get("channelId") || "") } });
  if (!channel) return { error: "המספר לא נמצא." };
  const isOwner = channel.ownerUserId === user.id;
  if (!isOwner && !canManageClients(user.role)) return { error: "אין הרשאה." };
  const picked = [...new Set(formData.getAll("excluded").map(String).filter(Boolean))].slice(0, 300);
  // Only active people may be added (lib/comms/channel-people.ts). Someone
  // already on the list who is no longer active is not in the form, and stays
  // on the list: taking them off would let them see the number if they come
  // back.
  const added = picked.filter((id) => !channel.excludedViewerIds.includes(id));
  if ((await ineligibleChannelPeople(added)).length > 0) {
    return { error: "ברשימת \"מי לא יראה\" אפשר לסמן רק משתמשים פעילים במערכת." };
  }
  const kept = await ineligibleChannelPeople(channel.excludedViewerIds);
  const excludedViewerIds = nextExcludedViewers({ channel, editorId: user.id, picked: [...picked, ...kept.filter((id) => !picked.includes(id))] });
  await prisma.commsChannel.update({ where: { id: channel.id }, data: { excludedViewerIds } });
  await recordAudit({
    actorId: user.id,
    action: "comms_channel.excluded_viewers_updated",
    entityType: "CommsChannel",
    entityId: channel.id,
    before: { excludedViewerIds: channel.excludedViewerIds },
    after: { excludedViewerIds },
  });
  refresh();
  return { ok: excludedViewerIds.length ? "הרשימה נשמרה." : "הרשימה נשמרה. כל מי שיש לו גישה רואה עכשיו את השיחות מהמספר." };
}

/// "שינוי בעלים" (5.11.2026): a manager moves a connected number to another
/// person. Anna's number had been connected to an archived user with her name,
/// and the only way to fix it was by hand in the database, with nothing in the
/// audit log. The new owner has to meet the same rule as at connecting, and is
/// taken off the number's "מי לא יראה" list if they were on it (the owner sees
/// every conversation). Conversations already stored and the block list stay
/// as they are. Nothing is cached per person: commsAccess reads the owned
/// numbers on every request, so the change takes effect on the next page load.
export async function changeChannelOwnerAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const user = await requireUser();
  if (!canManageClients(user.role)) return { error: "רק מנהל יכול לשנות בעלים של מספר." };
  const channelId = String(formData.get("channelId") || "");
  const newOwnerId = String(formData.get("ownerUserId") || "");
  const channel = await prisma.commsChannel.findUnique({ where: { id: channelId } });
  if (!channel) return { error: "המספר לא נמצא." };
  if (!newOwnerId) return { error: "לא נבחר בעלים חדש." };
  if (channel.ownerUserId === newOwnerId) return { error: "זה כבר הבעלים של המספר." };
  const newOwner = await prisma.user.findFirst({ where: { ...CHANNEL_PERSON_WHERE, id: newOwnerId }, select: { name: true, email: true } });
  if (!newOwner) return { error: "אפשר לבחור כבעלים רק משתמש פעיל במערכת." };

  const before = { ownerUserId: channel.ownerUserId, excludedViewerIds: channel.excludedViewerIds };
  const excludedViewerIds = channel.excludedViewerIds.filter((id) => id !== newOwnerId);
  // Only if nobody changed the owner in between (two managers at once).
  const { count } = await prisma.commsChannel.updateMany({
    where: { id: channel.id, ownerUserId: channel.ownerUserId },
    data: { ownerUserId: newOwnerId, excludedViewerIds },
  });
  if (count === 0) return { error: "הבעלים של המספר השתנה בינתיים. רעננו את הדף ונסו שוב." };
  await recordAudit({
    actorId: user.id,
    action: "comms_channel.owner_changed",
    entityType: "CommsChannel",
    entityId: channel.id,
    before,
    after: { ownerUserId: newOwnerId, excludedViewerIds },
  });
  refresh();
  return {
    ok: `הבעלים של המספר עכשיו ${personLabel(newOwner)}. השיחות שכבר נשמרו ורשימת החסימה לא השתנו.`,
  };
}

function target(formData: FormData): { kind: "PHONE" | "CHAT"; value: string; label: string | null } | null {
  const kind = formData.get("kind") === "CHAT" ? "CHAT" : "PHONE";
  const raw = String(formData.get("value") || "").slice(0, 200);
  const label = String(formData.get("label") || "").trim().slice(0, 120) || null;
  if (kind === "PHONE") {
    const phone = normalizePhone(raw);
    return phone && /^\+\d{8,15}$/.test(phone) ? { kind, value: phone, label } : null;
  }
  return /^[A-Za-z0-9._-]+@[A-Za-z0-9.]+$/.test(raw) ? { kind, value: raw, label } : null;
}

/// One "לא לשמור" (the setup list, or the button on a conversation).
export async function blockAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const g = await gate();
  if (g.error) return { error: g.error };
  const t = target(formData);
  const channelId = String(formData.get("channelId") || "");
  if (!t || !channelId) return { error: "לא ברור מה לחסום." };
  try {
    const { block } = await requestBlock(g.user, { channelId, ...t });
    refresh();
    return {
      ok:
        block.status === "APPROVED"
          ? "נחסם. מה שנשמר ממנו נמחק, ושום דבר ממנו לא יישמר."
          : "נשלחה בקשה למנהל. עד ההחלטה ההודעות לא מוצגות לאף אחד.",
    };
  } catch (err) {
    if (err instanceof BlockError) return { error: err.message };
    throw err;
  }
}

/// The setup list: several "לא לשמור" at once (values "PHONE|+972..." or
/// "CHAT|<chat id>|<name>").
export async function blockManyAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const g = await gate();
  if (g.error) return { error: g.error };
  const channelId = String(formData.get("channelId") || "");
  const picked = formData.getAll("block").map(String).slice(0, 300);
  let done = 0;
  for (const item of picked) {
    const [kind, value, ...rest] = item.split("|");
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("value", value ?? "");
    fd.set("label", rest.join("|"));
    const t = target(fd);
    if (!t) continue;
    try {
      await requestBlock(g.user, { channelId, ...t });
      done += 1;
    } catch (err) {
      if (err instanceof BlockError) return { error: err.message };
      throw err;
    }
  }
  refresh();
  return { ok: done ? `סומנו ${done} שיחות "לא לשמור".` : "לא סומנה אף שיחה." };
}

export async function startStoringAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const g = await gate();
  if (g.error) return { error: g.error };
  try {
    await startStoring(g.user, String(formData.get("channelId") || ""));
  } catch (err) {
    if (err instanceof BlockError) return { error: err.message };
    throw err;
  }
  // The history starts loading now, not at night: as much as a minute
  // allows, after the answer has gone out. The nightly run does the rest.
  const channelId = String(formData.get("channelId") || "");
  await afterResponse("comms: first history load", async () => {
    const channel = await prisma.commsChannel.findUnique({ where: { id: channelId } });
    if (channel) await backfillChannel(channel, { budgetMs: 50_000, transcribe: transcribeRecording });
  });
  refresh();
  // The form that would show a message is gone from the page once storing
  // has started, so the page itself says so (?started=1).
  redirect("/app/whatsapp-poc/setup?started=1");
}

export async function decideBlockAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const g = await gate();
  if (g.error) return { error: g.error };
  if (!canManageClients(g.user.role)) return { error: "רק מנהל מחליט על חסימה." };
  try {
    await decideBlock(g.user, String(formData.get("blockId") || ""), formData.get("decision") === "approve");
  } catch (err) {
    if (err instanceof BlockError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "נשמר." };
}

export async function revokeBlockAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const g = await gate();
  if (g.error) return { error: g.error };
  try {
    await revokeBlock(g.user, String(formData.get("blockId") || ""));
  } catch (err) {
    if (err instanceof BlockError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "החסימה בוטלה. מעכשיו השיחות נשמרות שוב." };
}

/// "טעינת היסטוריה עכשיו": the next part of the history, now, instead of at
/// night. Up to about a minute of loading per press, after the answer.
export async function loadHistoryAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const g = await gate();
  if (g.error) return { error: g.error };
  const channel = await prisma.commsChannel.findUnique({ where: { id: String(formData.get("channelId") || "") } });
  if (!channel?.storeEnabled) return { error: "השמירה עוד לא התחילה." };
  if (channel.ownerUserId !== g.user.id && !canManageClients(g.user.role)) return { error: "אין הרשאה." };
  await afterResponse("comms: history load on request", async () => {
    await backfillChannel(channel, { budgetMs: 50_000, transcribe: transcribeRecording });
  });
  return { ok: "הטעינה רצה ברקע, כדקה. רעננו את מסך התקשורת בעוד דקה. אפשר ללחוץ שוב כדי להמשיך." };
}

/// 2.11.2026: recordings Aloha sent by hand (a batch for one line, no other
/// side), into the store. Managers only. Runs after the response; running it
/// again stores nothing twice.
export async function importManualRecordingsAction(_prev: SetupState | undefined): Promise<SetupState> {
  const g = await gate();
  if (g.error) return { error: g.error };
  if (!canManageClients(g.user.role)) return { error: "אין הרשאה." };
  const actorId = g.user.id;
  await afterResponse("comms: manual recordings import", async () => {
    await importManualRecordings(actorId);
  });
  return { ok: "הייבוא רץ ברקע, כדקה. ההקלטות יופיעו במסך התקשורת, ויתומללו בריצה הלילית." };
}

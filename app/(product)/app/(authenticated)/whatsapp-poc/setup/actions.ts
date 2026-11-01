"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { canManageClients } from "@/lib/app-auth/permissions";
import { canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { normalizePhone } from "@/lib/contact-normalize";
import { readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { BlockError, decideBlock, requestBlock, revokeBlock, startStoring } from "@/lib/comms/whatsapp-store";
import { prisma } from "@/lib/prisma";

export type SetupState = { error?: string; ok?: string };

const PATHS = ["/app/whatsapp-poc", "/app/whatsapp-poc/setup"];
function refresh() {
  for (const p of PATHS) revalidatePath(p);
}

async function gate() {
  const user = await requireUser();
  const config = readPocConfig();
  if (!canViewWhatsappPoc(user, config.viewers)) return { user, error: "אין הרשאה." as const };
  return { user, config, error: null };
}

/// Connect the configured WhatsApp account as a channel, owned by the person
/// connecting it, with the people who must never see its conversations.
export async function connectChannelAction(_prev: SetupState | undefined, formData: FormData): Promise<SetupState> {
  const g = await gate();
  if (g.error || !g.config) return { error: g.error ?? "אין הרשאה." };
  const accountId = g.config.accountId;
  if (!accountId) return { error: "חשבון WhatsApp לא מוגדר בסביבה הזו." };
  const excluded = formData.getAll("excluded").map(String).filter((id) => id && id !== g.user.id);
  const valid = await prisma.user.findMany({ where: { id: { in: excluded }, deletedAt: null }, select: { id: true } });
  const channel = await prisma.commsChannel.upsert({
    where: { accountId },
    create: { accountId, ownerUserId: g.user.id, excludedViewerIds: valid.map((u) => u.id) },
    update: { excludedViewerIds: valid.map((u) => u.id) },
  });
  await recordAudit({
    actorId: g.user.id,
    action: "comms_channel.connected",
    entityType: "CommsChannel",
    entityId: channel.id,
    after: { excludedViewerIds: channel.excludedViewerIds },
  });
  refresh();
  return { ok: "המספר מחובר. עכשיו מסמנים מה לא לשמור." };
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
  refresh();
  return { ok: "השמירה התחילה. ההיסטוריה נטענת בהדרגה, בלילות הקרובים." };
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

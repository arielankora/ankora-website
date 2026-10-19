import { parseExternalRefs, type ExternalRef } from "@/lib/external-refs";

// Spec 3.1: the owner and "visible to the client" fields of an item's form
// (knowledge-ui.tsx, ItemExtras), read the same way by every action. A form
// without them changes neither.

export function itemExtrasFrom(
  f: FormData,
  selfId?: string
): { clientVisible?: boolean; ownerId?: string | null; doNotDisclose?: string | null; audienceUserIds?: string[]; externalRefs?: ExternalRef[]; audience?: "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED" } {
  if (f.get("itemExtras") !== "1") return {};
  return {
    // Spec 3.1: RAID-002, ClickUp:86c1x, as the team writes them.
    ...(f.has("externalRefs") ? { externalRefs: parseExternalRefs(String(f.get("externalRefs") ?? "")) } : {}),
    // The forms whose audience field is the shared one (AudienceField in
    // ItemExtras). A form with its own field reads it itself.
    ...(f.get("itemAudience") === "1" ? { audience: audienceOf(f.get("audience")) } : {}),
    ...audiencePeopleFrom(f, selfId),
    ...(f.get("itemDisclose") === "1" ? { doNotDisclose: String(f.get("doNotDisclose") ?? "").trim() || null } : {}),
    clientVisible: f.get("clientVisible") === "on",
    ...(f.has("itemOwnerId") ? { ownerId: String(f.get("itemOwnerId") ?? "").trim() || null } : {}),
  };
}

/// Spec 3.1: the people a restricted or account-team item is shown to
/// (AudienceField). Whoever saves it is on the list, so nobody locks
/// themselves out of what they wrote. Shown to everyone, it names nobody.
export function audiencePeopleFrom(f: FormData, selfId?: string): { audienceUserIds?: string[] } {
  const audience = String(f.get("audience") ?? "");
  if (audience === "ALL_STAFF") return f.has("audience") ? { audienceUserIds: [] } : {};
  if (f.get("audiencePeople") !== "1") return {};
  const ids = f.getAll("audienceUserIds").map((v) => String(v).trim()).filter(Boolean);
  if (selfId && audience === "RESTRICTED") ids.push(selfId);
  return { audienceUserIds: [...new Set(ids)] };
}

function audienceOf(v: FormDataEntryValue | null): "ALL_STAFF" | "ACCOUNT_TEAM" | "RESTRICTED" {
  return v === "ACCOUNT_TEAM" || v === "RESTRICTED" ? v : "ALL_STAFF";
}

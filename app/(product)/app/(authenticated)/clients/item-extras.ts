// Spec 3.1: the owner and "visible to the client" fields of an item's form
// (knowledge-ui.tsx, ItemExtras), read the same way by every action. A form
// without them changes neither.

export function itemExtrasFrom(f: FormData): { clientVisible?: boolean; ownerId?: string | null } {
  if (f.get("itemExtras") !== "1") return {};
  return {
    clientVisible: f.get("clientVisible") === "on",
    ...(f.has("itemOwnerId") ? { ownerId: String(f.get("itemOwnerId") ?? "").trim() || null } : {}),
  };
}

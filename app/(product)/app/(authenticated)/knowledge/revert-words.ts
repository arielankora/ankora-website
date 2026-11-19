// "ביטול" says what it does: a new item leaves the file, a change
// (SUPERSEDE, CONTRADICT) is put back as the item was (19.11.2026). Keys
// under `knowledge` in messages/*.json.
export function revertWords(action: string | undefined) {
  const change = action === "SUPERSEDE" || action === "CONTRADICT";
  return change
    ? ({ done: "revert.change.done", confirm: "revert.change.confirm", removing: "revert.change.restoring", remove: "revert.change.restore" } as const)
    : ({ done: "revert.done", confirm: "revert.confirm", removing: "revert.removing", remove: "revert.remove" } as const);
}

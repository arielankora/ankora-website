// The one rule for the text of a portal note (TaskPortalNote), shared by
// the server and the form, so the screen and the save agree on what is
// accepted. Pure: no database, safe to import anywhere.

export const MAX_PORTAL_NOTE_LENGTH = 200;

/// One short line the client reads, such as "רותם כהן · פגישה ברביעי 11.11
/// ב-11:00". Newlines are folded to spaces: the portal shows a list, and a
/// line that breaks in the middle reads as two entries.
export function checkPortalNote(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { ok: false, error: "השורה ללקוח ריקה." };
  if (text.length > MAX_PORTAL_NOTE_LENGTH) {
    return { ok: false, error: `השורה ללקוח ארוכה מ-${MAX_PORTAL_NOTE_LENGTH} תווים.` };
  }
  return { ok: true, text };
}

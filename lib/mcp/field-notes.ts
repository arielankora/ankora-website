// What a tool's result fields mean, sent with the result instead of in the
// tool's description.
//
// 17.11.2026: Claude Desktop asks the user to allow a tool again whenever
// its definition changes. Over the 30 days before this file, most of the
// changes to the busiest read tools only explained a new field of their
// result (all 7 of get_proposal_stats's). A note here reaches Claude with
// the field itself, and adding one changes no definition.
//
// It also moves the text to where it costs least: a description is in
// every conversation that has the connector, a note only in the result of
// a call that returned that field.
//
// The rule: a tool's description says what the tool is for, what to pass
// and what to do before calling it. What a returned field means, and what
// to do when it is there, is a note.

export type FieldNotes = Readonly<Record<string, string>>;

/// The one sentence a tool with notes keeps in its description, so Claude
/// knows to read them.
export const FIELD_NOTES_SENTENCE = "Its result explains the fields it carries in `fieldNotes`: read them before answering.";

/// Every key `value` carries with a value, at any depth.
function presentKeys(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) presentKeys(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue;
      into.add(key);
      presentKeys(v, into);
    }
  }
  return into;
}

/// `value` with `fieldNotes` at the end: the notes for the fields it
/// carries, in the order `notes` lists them. A note keyed "*" always goes.
/// No field with a note, no `fieldNotes`.
export function withFieldNotes<T extends Record<string, unknown>>(value: T, notes: FieldNotes): T & { fieldNotes?: Record<string, string> } {
  const present = presentKeys(value, new Set());
  const picked: Record<string, string> = {};
  for (const [key, note] of Object.entries(notes)) {
    if (key === "*" || present.has(key)) picked[key] = note;
  }
  return Object.keys(picked).length ? { ...value, fieldNotes: picked } : value;
}

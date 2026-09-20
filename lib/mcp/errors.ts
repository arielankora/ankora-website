// Phase 13 (MCP server, docs/adr/0005): turning a domain error into
// something the *model* can act on.
//
// The Server Actions in app/(product)/app/**/actions.ts each carry a
// `friendlyError()` that maps these same error classes to Hebrew strings
// for a human staring at a screen ("אין לך הרשאה לבצע פעולה זו."). That is
// right for a screen and wrong here, for two reasons: a dead-end sentence
// gives Claude nothing to do next, and the Hebrew is aimed at a reader who
// can already see the surrounding UI state that the model cannot.
//
// So this module maps by `err.name` rather than `instanceof`. That keeps
// the file pure - no `server-only`, no Prisma, no import of
// lib/app-domain/time-entries.ts - which is what lets
// tests/unit/mcp/errors.test.ts run it directly. It also survives the
// class being re-exported or wrapped somewhere in between, which
// `instanceof` does not.

export type McpToolError = {
  /// Sent back to the model. Says what went wrong AND what to try next.
  message: string;
  /// False for "this will never work, stop trying" (no permission),
  /// true for "a different call could succeed" (stop the timer first).
  recoverable: boolean;
};

/// Errors the model can do something about get an explicit next step.
/// Anything not listed here falls through to a deliberately vague message
/// - see `toMcpToolError` for why that is the safe default.
const KNOWN: Record<string, McpToolError> = {
  ForbiddenError: {
    message:
      "Permission denied: your Ankora role does not allow this action. Do not retry this tool. Tell the user which action was refused and suggest they ask an Ankora admin.",
    recoverable: false,
  },
  UnauthorizedError: {
    message:
      "Your Ankora MCP token is no longer valid (revoked, expired, or the account was deactivated). Do not retry. Tell the user to issue a new token.",
    recoverable: false,
  },
  ActiveTimerExistsError: {
    message:
      "A timer is already running for this user. Call get_active_timer to see what it is, then either stop it with stop_timer or leave it running. Ankora allows only one active timer per user.",
    recoverable: true,
  },
  EditWindowExpiredError: {
    message:
      "This entry is outside the 48-hour self-edit window, so the user cannot change it themselves. Do not retry. Tell the user an Ankora admin has to make this edit.",
    recoverable: false,
  },
  OverlapError: {
    message:
      "The time range overlaps an existing entry for this user. Call list_my_time_entries for that day to see what is already recorded, then pick a range that does not collide.",
    recoverable: true,
  },
  BackdateReasonRequiredError: {
    message:
      "Backdated entries require a reason. Ask the user why the entry is being added late, then call the tool again with that reason.",
    recoverable: true,
  },
  FutureEntryError: {
    message:
      "The entry ends in the future, which Ankora does not accept. Check the date and time with the user and call again.",
    recoverable: true,
  },
  ConflictError: {
    message:
      "This record changed since it was read. Re-read it with the matching list or get tool and retry once with fresh values.",
    recoverable: true,
  },
};

/// Maps a thrown value to the text the tool returns.
///
/// The fallback is intentionally uninformative. An unexpected throw from
/// the domain layer can carry a Prisma error with a table name, a
/// constraint, or a fragment of a row in it, and `/api/mcp` hands its
/// output straight to a model that may repeat it back to the user or into
/// a chat log. Known errors are curated above; everything else is logged
/// server-side and summarised here.
export function toMcpToolError(err: unknown): McpToolError {
  const name = err instanceof Error ? err.name : "";
  const known = KNOWN[name];
  if (known) return known;

  return {
    message:
      "Ankora could not complete this action because of an unexpected server error. Do not retry the same call. Tell the user the action failed and that the error is recorded in Ankora's logs.",
    recoverable: false,
  };
}

/// Shapes a tool failure the way the MCP SDK expects. `isError: true` is
/// what tells the client this is a failed call rather than a successful
/// one that happens to describe a problem.
export function toolFailure(err: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const { message } = toMcpToolError(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

/// Shapes a successful tool result carrying JSON. Tool output goes back as
/// text either way; pretty-printing costs a few tokens and buys far more
/// reliable reading by the model than a single dense line.
export function toolJson(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/// Shapes a successful tool result carrying prose. Used where a sentence
/// reads better than a JSON object ("No timer is running.").
export function toolText(text: string): {
  content: { type: "text"; text: string }[];
} {
  return { content: [{ type: "text", text }] };
}

/// Which tables the nightly backup carries, and which it deliberately
/// does not.
///
/// This file exists because the first version of the nightly dump
/// hand-listed six Prisma models inside `dumpCoreTables()`. The schema
/// had thirty-six. Nothing was wrong with the six that were there; the
/// problem was that the list could not tell anyone it had fallen
/// behind, and it had - `BillingPolicy` (rounding rules), and
/// `HourBankAdjustment` (every manual correction to a client's balance,
/// and its reason) were both missing, which means the dump could not
/// actually deliver the thing its own header comment promised: enough
/// data to reconstruct "who is owed what".
///
/// So coverage is now a decision per model, recorded here, and
/// `tests/unit/backup-coverage.test.ts` reads `prisma/schema.prisma`
/// and fails if a model exists that this file does not mention. Adding
/// a model to the schema without deciding what the backup does with it
/// is a build failure, not a silent gap discovered during a restore.
///
/// Two rules that are easy to get wrong, both of them load-bearing:
///
///   1. **Soft-deleted rows are dumped.** Every other query in this
///      product filters `deletedAt: null`, and the old dump did too.
///      A backup must not: a live `TimeEntry` can point at a
///      soft-deleted `Client`, so dropping that client turns the
///      restore into a foreign-key violation. "Deleted" is an
///      application-layer meaning; referential integrity is not.
///   2. **Skipping is a decision with a recovery path,** not an
///      omission. Every SKIP below says how the thing it leaves out is
///      regained after a restore. If that sentence cannot be written,
///      the table belongs in the dump.

export type BackupCoverage =
  | {
      decision: "DUMP";
      table: string;
      /// Columns whose real value is never read out of the database and
      /// never reaches the dump. The map gives what is written in its
      /// place, because a redacted column still has to satisfy the
      /// schema: `users.passwordHash` is NOT NULL, so redacting it to
      /// null produces a dump that cannot be restored at all. That is
      /// not a hypothetical - it is what
      /// tests/integration/backup-restore-roundtrip.test.ts caught on
      /// its first run against a real database.
      redact?: Readonly<Record<string, string | null>>;
      reason: string;
    }
  | {
      decision: "SKIP";
      table: string;
      reason: string;
      /// How this data is regained after a restore. Required, on
      /// purpose: see rule 2 above.
      recovery: string;
    };

/// What `users.passwordHash` carries in the dump instead of the hash.
///
/// Deliberately not a valid bcrypt string: `bcrypt.compare` returns
/// false for it rather than throwing (verified against this repo's
/// bcryptjs), so a restored account fails closed at sign-in and its
/// owner goes through the existing forgot-password flow. Anything that
/// looked like a real hash would invite someone to try to crack it.
export const REDACTED_PASSWORD_HASH = "REDACTED-IN-BACKUP-PASSWORD-RESET-REQUIRED";

const CREDENTIAL_TABLE_RECOVERY =
  "Re-issued through the flow that creates it in the first place. Restoring a hashed credential would restore a session or a token that nobody can produce the plaintext for anyway.";

export const BACKUP_COVERAGE: Readonly<Record<string, BackupCoverage>> = {
  // ---- Identity and access -------------------------------------------------
  User: {
    decision: "DUMP",
    table: "users",
    // passwordHash is a bcrypt hash, not a plaintext secret, and dumping
    // it would still be wrong: this file travels to Google Drive and to
    // two inboxes, both outside the database's access boundary. A
    // restored user resets through the existing PasswordResetToken flow
    // (lib/app-domain/auth.ts), which is a supported path, not a gap.
    // `tokenVersion` IS dumped: it is a counter, and restoring it too
    // low would re-validate sessions that were deliberately revoked.
    redact: { passwordHash: REDACTED_PASSWORD_HASH },
    reason: "Every employee account, role and status. Without it there is nobody to attribute any restored row to.",
  },
  ClientUser: {
    decision: "DUMP",
    table: "client_users",
    reason: "Portal identities. Without it clients cannot reach their own portal after a restore.",
  },
  UserClientAccess: {
    decision: "DUMP",
    table: "user_client_access",
    reason: "Who may see which client. Rebuilding this by memory is how a restore becomes a privacy incident.",
  },

  // ---- Core business objects -----------------------------------------------
  Client: { decision: "DUMP", table: "clients", reason: "The customer list, all statuses, including archived." },
  Category: { decision: "DUMP", table: "categories", reason: "Every time entry and task points at one." },
  Task: { decision: "DUMP", table: "tasks", reason: "The work itself, subtasks included (tasks.parentId is restored parent-first)." },
  TaskComment: { decision: "DUMP", table: "task_comments", reason: "The conversation on a task is part of the task; it exists nowhere else." },
  TaskPlan: { decision: "DUMP", table: "task_plans", reason: "Every version of a task's work plan, and who approved it. Written by a person and Claude together; it exists nowhere else." },
  TimeEntry: { decision: "DUMP", table: "time_entries", reason: "The billable record. This is the row the business is built on." },
  ClientDocument: {
    decision: "DUMP",
    table: "client_documents",
    // The bytes live in Google Drive; what lives only here is the
    // mapping from a client and a task to driveFileId. Lose it and the
    // Drive folder is a pile of files with no owner.
    reason: "The mapping from client and task to the Drive file id. The file bytes are in Drive, the meaning is here.",
  },

  // ---- Money ---------------------------------------------------------------
  BillingPolicy: {
    decision: "DUMP",
    table: "billing_policies",
    // Missing from the original six. Restoring time entries without it
    // means recomputing billable minutes under default rounding, which
    // silently produces invoices that differ from the ones already sent.
    reason: "Rounding, minimum and increment per client. Restored time entries without it bill differently than they originally did.",
  },
  HourBank: { decision: "DUMP", table: "hour_banks", reason: "Purchased and consumed minutes per cycle." },
  HourBankAdjustment: {
    decision: "DUMP",
    table: "hour_bank_adjustments",
    // Also missing from the original six, and the more damaging of the
    // two: HourBank carries the balance, this carries how the balance
    // got there. Without it a recalculation after a restore produces a
    // different number and nobody can explain the difference to a client.
    reason: "Every manual correction to a balance, with its reason and its author. The audit answer to 'why does this client have these minutes'.",
  },

  // ---- Commitments, alerts, reporting --------------------------------------
  AlertRule: { decision: "DUMP", table: "alert_rules", reason: "Configuration a human wrote; nothing regenerates it." },
  ReportSchedule: { decision: "DUMP", table: "report_schedules", reason: "Configuration a human wrote; nothing regenerates it." },
  ImportantDate: { decision: "DUMP", table: "important_dates", reason: "Commitments to clients, the product's own promise surface." },
  ReminderRule: { decision: "DUMP", table: "reminder_rules", reason: "Configuration attached to an important date." },
  ReminderOccurrence: {
    decision: "DUMP",
    table: "reminder_occurrences",
    reason: "Carries the idempotency keys of reminders already sent. Losing it re-sends past reminders to clients on the next run.",
  },
  HolidayCalendarSubscription: { decision: "DUMP", table: "holiday_calendar_subscriptions", reason: "Per-client calendar configuration." },
  Decision: { decision: "DUMP", table: "decisions", reason: "A decision and its context; client-facing and not reconstructible." },
  DecisionOption: { decision: "DUMP", table: "decision_options", reason: "Without the options a decision row means nothing." },
  DecisionResponse: { decision: "DUMP", table: "decision_responses", reason: "What the client actually chose, and when." },
  Notification: { decision: "DUMP", table: "notifications", reason: "In-app state a person sees; read/unread is cheap to keep and jarring to lose." },
  PortalSummary: { decision: "DUMP", table: "portal_summaries", reason: "Client-visible text. Regenerable in principle, but it is what the client last read." },

  // ---- Integrations --------------------------------------------------------
  IntegrationConnection: {
    decision: "DUMP",
    table: "integration_connections",
    // credentialsRef is an opaque pointer into an external secret store
    // (schema comment, spec 17.2) and never the credential itself, so it
    // is safe here and useless to an attacker without that store.
    reason: "Which providers are connected and how they are configured. credentialsRef is a pointer, never a secret.",
  },
  ExternalMapping: { decision: "DUMP", table: "external_mappings", reason: "Local id to external id. Rebuilding it means re-matching every object by hand." },

  // ---- History and evidence ------------------------------------------------
  // These are append-only and regenerate for nothing. They are the
  // answer to "what happened", which is exactly the question asked after
  // the kind of event that makes anyone open a backup at all. They are
  // also the tables that grow without bound, which is what
  // DUMP_SIZE_WARN_BYTES below watches.
  // Credentials vault (6.10.2026). Dumped as stored: ciphertext, IV, tag
  // and a data key wrapped by the production key (VAULT_KEK, a sensitive
  // Vercel variable that is never in a backup). Without that key
  // none of it is readable, so the dump carries no usable secret, and
  // without the rows a restore would silently lose every client login.
  // Restoring keeps the ids, which matters: each ciphertext is bound to
  // its row id and client id (lib/vault/crypto.ts). The nightly XLSX
  // never includes this table (tests/unit/vault-guards.test.ts).
  ClientCredential: {
    decision: "DUMP",
    table: "client_credentials",
    reason: "Clients' logins, encrypted under a key that is not in the backup. Not reconstructible, and unreadable without that key.",
  },
  // Passkeys (vault phase 1a). Public keys only; the private half never
  // left anyone's device. Kept so a restore does not force everyone to
  // enrol again before they can open a client's login.
  Passkey: {
    decision: "DUMP",
    table: "passkeys",
    reason: "Which devices may answer \"verify it's you\". Public keys only; without them nobody can reveal a credential until they enrol again.",
  },
  WebAuthnChallenge: {
    decision: "SKIP",
    table: "webauthn_challenges",
    reason: "Single-use challenges that expire in five minutes.",
    recovery: "The next prompt issues a new one.",
  },
  StepUpGrant: {
    decision: "SKIP",
    table: "step_up_grants",
    reason: "Five-minute \"verified it's you\" windows. Expired long before any restore.",
    recovery: "The person verifies again on their next reveal.",
  },

  AuditEvent: { decision: "DUMP", table: "audit_events", reason: "The compliance trail. Irreplaceable, and the first thing asked for after an incident." },
  TimeEntryRevision: { decision: "DUMP", table: "time_entry_revisions", reason: "How a billable record changed, which is the defence when a client disputes one." },
  EmailDelivery: { decision: "DUMP", table: "email_deliveries", reason: "Proof that a report or an alert was actually sent." },
  AlertEvent: { decision: "DUMP", table: "alert_events", reason: "Which alerts fired; also what suppresses a duplicate alert after a restore." },
  ReportRun: { decision: "DUMP", table: "report_runs", reason: "Which scheduled report ran, and what it contained." },

  // ---- Credentials: deliberately not in the backup -------------------------
  // Every one of these holds a hash or a short-lived grant. Restoring
  // them adds risk to a file that leaves the database boundary and buys
  // nothing, because none of them can be turned back into something a
  // person can use.
  PasswordResetToken: { decision: "SKIP", table: "password_reset_tokens", reason: "Single-use password reset hashes, valid for minutes.", recovery: "The user asks for a new reset link." },
  PortalLoginToken: { decision: "SKIP", table: "portal_login_tokens", reason: "Single-use portal login hashes, valid for one click.", recovery: "The client asks for a new portal link." },
  McpAccessToken: { decision: "SKIP", table: "mcp_access_tokens", reason: "Hashed MCP access tokens, one per integration client.", recovery: "Re-issue with scripts/mcp-issue-token.ts." },
  OAuthClient: {
    decision: "SKIP",
    table: "oauth_clients",
    reason: "Holds clientSecretHash. Restoring the row without a usable secret produces a client that fails to authenticate for reasons nobody can see.",
    recovery: "Re-register the client, which mints a fresh secret.",
  },
  OAuthAuthorizationCode: { decision: "SKIP", table: "oauth_authorization_codes", reason: "Authorization grants that expire within a minute of being issued.", recovery: CREDENTIAL_TABLE_RECOVERY },
  OAuthToken: { decision: "SKIP", table: "oauth_tokens", reason: "Hashed OAuth access and refresh tokens; the plaintext exists only on the client.", recovery: CREDENTIAL_TABLE_RECOVERY },
} as const;

/// Columns whose NAME looks like a secret but which are dumped on
/// purpose. The unit test flags any column in a dumped table matching
/// /pass|secret|token|hash|key|credential/i that is neither redacted nor
/// listed here - so the day somebody adds `apiSecret` to a dumped table,
/// the build asks about it instead of the column quietly riding along to
/// Drive.
export const ACKNOWLEDGED_SENSITIVE_COLUMNS: Readonly<Record<string, string>> = {
  "users.tokenVersion": "A revocation counter, not a credential. Restoring it too low would revive revoked sessions.",
  "integration_connections.credentialsRef": "An opaque pointer into an external secret store (schema comment / spec 17.2), never the credential.",
  "holiday_calendar_subscriptions.calendarKey": "A public calendar identifier such as 'IL-jewish'.",
  "important_dates.holidayKey": "A public holiday identifier.",
  "reminder_occurrences.idempotencyKey": "A de-duplication key. Losing it re-sends reminders; it grants nothing.",
  "tasks.importantDateOccurrenceKey": "A de-duplication key for generated tasks.",
  // Credentials vault. Every one of these is either ciphertext that
  // needs the production key to open, or a flag that says a value exists.
  "client_credentials.secretCiphertext": "AES-256-GCM ciphertext; the data key that opens it is wrapped by a key that is not in the backup.",
  "client_credentials.secretIv": "The GCM nonce. Public by design.",
  "client_credentials.secretTag": "The GCM authentication tag. Public by design.",
  "client_credentials.wrappedDek": "A wrapped data key. Useless without the key-encryption key, which is not in the backup.",
  "client_credentials.kekRef": "Which key wrapped the data key: a 64-bit fingerprint or a KMS key name. An identifier, not a key.",
  "client_credentials.hasPassword": "A yes/no flag for the list screen.",
  "client_credentials.secretUpdatedAt": "When the secret last changed. A timestamp.",
  "passkeys.publicKey": "The public half of a passkey. Verifies a signature; cannot make one.",
  "passkeys.credentialId": "The authenticator's public identifier for the passkey.",
} as const;

export const SENSITIVE_COLUMN_PATTERN = /pass|secret|token|hash|key|credential/i;

/// Above this, the serialized dump is still produced and still uploaded,
/// but the nightly job logs a warning naming the largest tables. It is
/// the signal that this JSON-through-the-app design has reached its
/// ceiling and the history tables want a real `pg_dump` on their own
/// schedule instead.
export const DUMP_SIZE_WARN_BYTES = 8 * 1024 * 1024;

/// Above this the dump is still uploaded to Drive but is NOT attached to
/// the nightly email, and the email says so. Resend caps a message at
/// 40MB and a silently rejected email is a worse failure than a smaller
/// one: Drive keeps full fidelity either way.
export const DUMP_EMAIL_ATTACH_MAX_BYTES = 20 * 1024 * 1024;

export function dumpedTables(): string[] {
  return Object.values(BACKUP_COVERAGE)
    .filter((c) => c.decision === "DUMP")
    .map((c) => c.table)
    .sort();
}

export function skippedTables(): string[] {
  return Object.values(BACKUP_COVERAGE)
    .filter((c) => c.decision === "SKIP")
    .map((c) => c.table)
    .sort();
}

export function redactionsByTable(): Record<string, Readonly<Record<string, string | null>>> {
  const out: Record<string, Readonly<Record<string, string | null>>> = {};
  for (const c of Object.values(BACKUP_COVERAGE)) {
    if (c.decision === "DUMP" && c.redact && Object.keys(c.redact).length) out[c.table] = c.redact;
  }
  return out;
}

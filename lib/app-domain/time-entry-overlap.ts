// Pure decision logic for the "אישור דיווח שעות חופף בין לקוחות שונים" spec
// (Phase 12). Extracted from lib/app-domain/time-entries.ts's assertNoOverlap
// so the actual RULE - not the DB query that finds a conflicting entry - is
// unit-testable in this sandbox, the same split already used for
// lib/app-domain/backup-export.ts / backup-export-format.ts (see that
// file's own header comment for why).
//
// The rule, per Ariel's approved spec and decisions:
//  1. Overlap is compared by exact clientId only (never task/category) - the
//     same person can never work two entries for the SAME client at the
//     same time, regardless of who is saving.
//  2. A same-client conflict is a hard block for anyone without
//     time_entry.edit_others - there is no self-service override for it.
//  3. A cross-client conflict CAN be overridden by anyone (self-service
//     included) once they've explicitly confirmed past the warning -
//     confirming does not require edit_others, unlike the existing
//     admin-only override.
//  4. An edit_others-privileged actor's existing override checkbox is
//     UNRESTRICTED in what it permits, exactly as before this feature - it
//     can still push through a same-client conflict too. Ariel's decision
//     2: when that admin override is what let a conflicting save through,
//     the saved row must ALSO be flagged as confirmed (isOverlapConfirmed),
//     just like a self-service cross-client confirmation.

export interface OverlapDecisionInput {
  /** clientId of the entry ALREADY on record that conflicts in time. */
  conflictClientId: string;
  /** clientId of the entry being saved (created or edited). */
  newEntryClientId: string;
  /** Whether the caller explicitly asked to push through the conflict
   *  (the self-service "save anyway" confirmation, or the admin's existing
   *  "אפשר חפיפה (override)" checkbox - both map to the same flag). */
  allowOverride: boolean;
  /** Whether the actor holds time_entry.edit_others (managers/admins). */
  hasEditOthersPermission: boolean;
}

export interface OverlapDecision {
  /** Whether the save may proceed despite the conflict. */
  allowed: boolean;
  /** Whether, if allowed, the row should be flagged isOverlapConfirmed. */
  confirmed: boolean;
  /** Whether the conflicting entry is for the exact same client. */
  sameClient: boolean;
}

export function resolveOverlapDecision(input: OverlapDecisionInput): OverlapDecision {
  const sameClient = input.conflictClientId === input.newEntryClientId;

  if (sameClient) {
    // No self-service override exists for a same-client conflict - only an
    // edit_others-privileged actor explicitly overriding can push it
    // through, exactly as this override worked before this feature.
    if (input.allowOverride && input.hasEditOthersPermission) {
      return { allowed: true, confirmed: true, sameClient };
    }
    return { allowed: false, confirmed: false, sameClient };
  }

  // Cross-client: any actor - self-service employee included - may proceed
  // once they've explicitly confirmed, no edit_others required.
  if (input.allowOverride) {
    return { allowed: true, confirmed: true, sameClient };
  }
  return { allowed: false, confirmed: false, sameClient };
}

/// Hadas, 23.9.2026: "לא נותן לשנות זמנים, מודיע על חפיפה למרות שאין חפיפה
/// ללקוח עצמו." A timer stores seconds; every edit form shows and submits
/// HH:MM only. Saving a form therefore rewrote 11:54:50 as 11:54:00, which
/// lands before a neighbouring timer that ended at 11:54:38, and that is a
/// same-client overlap nobody can confirm past. It fired on a note-only
/// edit too, because the form always sends both times.
///
/// The rule: a submitted time that names the same wall-clock minute as the
/// stored one is not a change. Keep the stored instant, seconds and all.
/// Israel's UTC offset is whole minutes, so comparing UTC minutes is the
/// same as comparing what the form showed.
export function keepStoredIfSameMinute(submitted: Date | undefined, stored: Date | null): Date | undefined {
  if (!submitted || !stored) return submitted;
  return Math.floor(submitted.getTime() / 60_000) === Math.floor(stored.getTime() / 60_000) ? undefined : submitted;
}

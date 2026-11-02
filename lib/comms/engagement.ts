// How long after a client is archived its conversations and recordings are
// kept (spec: "בסיום ההתקשרות הלקוח יכול לקבל ייצוא בתוך 30 יום, ואחר כך
// הכל נמחק"). The nightly sweep and the export link both read it.

export const ENGAGEMENT_END_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/// The day the archived client's conversations and recordings are deleted.
export function engagementDeletesOn(archivedAt: Date): Date {
  return new Date(archivedAt.getTime() + ENGAGEMENT_END_GRACE_DAYS * DAY_MS);
}

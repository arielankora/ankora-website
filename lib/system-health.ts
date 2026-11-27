import "server-only";
import { prisma } from "@/lib/prisma";
import { reportIssue, resolveIssue, describeError, type IssueSeverity } from "@/lib/system-issues";
import { readAccount, needsReconnect } from "@/lib/comms/self-connect";
import { TRANSCRIBE_MAX_ATTEMPTS } from "@/lib/comms/call-store";
import { CRON_JOBS } from "@/lib/app-domain/system-issues";

/// "What should have happened" (27.11.2026, silent failures plan, stage 2).
///
/// Some failures throw nothing: a WhatsApp number that stopped bringing in
/// messages, a transcript stuck in the queue, a nightly job that did not run
/// at all. Each check here asks whether something that should have happened
/// did. A check that fails is a system issue (area "health"); a check that
/// passes closes its issue, so an issue that cleared by itself does not wait
/// for a person.
///
/// Runs once each morning from /api/cron/system-health, before the morning
/// report reads the issues, and on data that already exists, so it adds one
/// database wake a day.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type CheckResult = {
  key: string;
  ok: boolean;
  severity: IssueSeverity;
  title: string;
  detail?: string;
};

export async function runHealthChecks(now = new Date()): Promise<{ checked: number; failed: number; results: CheckResult[] }> {
  const groups = await Promise.all([
    cronChecks(now),
    whatsappChecks(now),
    transcriptCheck(now),
    driveCopyCheck(now),
    recordingsCheck(now),
    reportScheduleChecks(now),
    leadsCheck(now),
    driveDeletionCheck(),
  ]);
  const results = groups.flat();
  let failed = 0;
  for (const r of results) {
    if (r.ok) await resolveIssue("health", r.key, now);
    else {
      failed += 1;
      await reportIssue({ area: "health", key: r.key, title: r.title, detail: r.detail, severity: r.severity, now });
    }
  }
  return { checked: results.length, failed, results };
}

const pass = (key: string): CheckResult => ({ key, ok: true, severity: "WARNING", title: "" });

/// Every nightly job ran in the last 26 hours, finished, and finished well.
/// Right after this ships the run log is empty: a job with no run is only
/// "did not run" once the log is older than a day.
export async function cronChecks(now: Date): Promise<CheckResult[]> {
  const first = await prisma.cronRun.findFirst({ orderBy: { startedAt: "asc" }, select: { startedAt: true } });
  const logOldEnough = Boolean(first && now.getTime() - first.startedAt.getTime() > 26 * HOUR);
  const jobs = CRON_JOBS.filter((job) => job !== "system-health");
  return Promise.all(
    jobs.map(async (job): Promise<CheckResult> => {
      const key = `cron:${job}`;
      const run = await prisma.cronRun.findFirst({ where: { job }, orderBy: { startedAt: "desc" } });
      if (!run) {
        return logOldEnough ? { key, ok: false, severity: "CRITICAL", title: `משימת הלילה ${job} לא רצה ביממה האחרונה` } : pass(key);
      }
      if (now.getTime() - run.startedAt.getTime() > 26 * HOUR) {
        return { key, ok: false, severity: "CRITICAL", title: `משימת הלילה ${job} לא רצה ביממה האחרונה`, detail: `ריצה אחרונה: ${run.startedAt.toISOString()}` };
      }
      if (!run.finishedAt && now.getTime() - run.startedAt.getTime() > 20 * 60 * 1000) {
        return { key, ok: false, severity: "CRITICAL", title: `משימת הלילה ${job} נקטעה באמצע (כנראה חרגה מהזמן)`, detail: `התחילה: ${run.startedAt.toISOString()}` };
      }
      // A failed step is already its own issue (lib/cron-run.ts); this one
      // only says the job did not run, or did not finish.
      return pass(key);
    }),
  );
}

/// Each number that stores its WhatsApp: connected in Unipile, and messages
/// stored lately. The two things that broke in silence in November.
export async function whatsappChecks(now: Date): Promise<CheckResult[]> {
  const channels = await prisma.commsChannel.findMany({
    where: { storeEnabled: true },
    select: { id: true, accountId: true, owner: { select: { name: true, email: true } } },
  });
  const out: CheckResult[] = [];
  for (const channel of channels) {
    const owner = channel.owner.name || channel.owner.email;
    const accountKey = `whatsapp-account:${channel.id}`;
    try {
      const account = await readAccount(channel.accountId);
      out.push(
        account.status === "running"
          ? pass(accountKey)
          : {
              key: accountKey,
              ok: false,
              severity: "CRITICAL",
              title: `ה-WhatsApp של ${owner} במצב ${account.status || "לא ידוע"}: הודעות לא נקלטות${needsReconnect(account.status) ? ", צריך לחבר מחדש" : ""}`,
            },
      );
    } catch (err) {
      out.push({ key: accountKey, ok: false, severity: "WARNING", title: `לא הצלחנו לבדוק ב-Unipile את ה-WhatsApp של ${owner}`, detail: describeError(err) });
    }
    const latest = await prisma.commsMessage.findFirst({
      where: { conversation: { channelId: channel.id } },
      orderBy: { at: "desc" },
      select: { at: true },
    });
    const quietKey = `whatsapp-quiet:${channel.id}`;
    // 48 hours, so a quiet weekend is not an issue.
    out.push(
      latest && now.getTime() - latest.at.getTime() > 48 * HOUR
        ? { key: quietKey, ok: false, severity: "WARNING", title: `לא נשמרה אף הודעת WhatsApp מהמספר של ${owner} ב-48 השעות האחרונות`, detail: `הודעה אחרונה: ${latest.at.toISOString()}` }
        : pass(quietKey),
    );
  }
  return out;
}

/// Transcripts waiting more than a day: the queue is stuck (a cap, a key,
/// a nightly run that does not reach it).
export async function transcriptCheck(now: Date): Promise<CheckResult[]> {
  const key = "transcripts-stuck";
  const waiting = await prisma.transcript.findMany({
    where: { status: "PENDING", attempts: { lt: TRANSCRIBE_MAX_ATTEMPTS }, createdAt: { lt: new Date(now.getTime() - DAY) } },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (waiting.length === 0) return [pass(key)];
  return [
    {
      key,
      ok: false,
      severity: "CRITICAL",
      title: `${waiting.length} שיחות והודעות קוליות מחכות לתמלול יותר מיממה`,
      detail: `הוותיקה ממתינה מאז ${waiting[0].createdAt.toISOString()}`,
    },
  ];
}

/// Audio still without its Drive copy a day later.
export async function driveCopyCheck(now: Date): Promise<CheckResult[]> {
  const key = "drive-copies-missing";
  const before = new Date(now.getTime() - DAY);
  const [calls, voice] = await Promise.all([
    prisma.callRecording.count({ where: { driveFileId: null, audioDeletedAt: null, createdAt: { lt: before } } }),
    prisma.commsAttachment.count({ where: { type: "audio", driveFileId: null, unavailable: false, createdAt: { lt: before } } }),
  ]);
  if (calls + voice === 0) return [pass(key)];
  return [{ key, ok: false, severity: "WARNING", title: `${calls + voice} קובצי שמע עדיין בלי עותק ב-Drive אחרי יממה`, detail: `הקלטות שיחה: ${calls}, הודעות קוליות: ${voice}` }];
}

/// No new call recording in three days: Aloha's mail or its template changed.
export async function recordingsCheck(now: Date): Promise<CheckResult[]> {
  const key = "recordings-quiet";
  const latest = await prisma.callRecording.findFirst({ orderBy: { callAt: "desc" }, select: { callAt: true } });
  if (!latest || now.getTime() - latest.callAt.getTime() <= 72 * HOUR) return [pass(key)];
  return [{ key, ok: false, severity: "WARNING", title: "לא נקלטה הקלטת שיחה חדשה מ-Aloha ב-72 השעות האחרונות", detail: `אחרונה: ${latest.callAt.toISOString()}` }];
}

/// A scheduled report that has not gone out for longer than its period.
export async function reportScheduleChecks(now: Date): Promise<CheckResult[]> {
  const schedules = await prisma.reportSchedule.findMany({
    where: { enabled: true, client: { deletedAt: null, status: { not: "ARCHIVED" } } },
    select: { id: true, frequency: true, lastSentAt: true, createdAt: true, client: { select: { name: true } } },
  });
  return schedules.map((s): CheckResult => {
    const key = `report-overdue:${s.id}`;
    const allowed = (s.frequency === "WEEKLY" ? 8 : 32) * DAY;
    const since = s.lastSentAt ?? s.createdAt;
    if (now.getTime() - since.getTime() <= allowed) return pass(key);
    return {
      key,
      ok: false,
      severity: "CRITICAL",
      title: `הדוח ה${s.frequency === "WEEKLY" ? "שבועי" : "חודשי"} של ${s.client.name} לא נשלח בזמן`,
      detail: s.lastSentAt ? `נשלח לאחרונה ${s.lastSentAt.toISOString()}` : "עוד לא נשלח אף פעם",
    };
  });
}

/// Website leads that never reached info@.
export async function leadsCheck(now: Date): Promise<CheckResult[]> {
  const key = "leads-undelivered";
  const count = await prisma.websiteLead.count({
    where: { emailStatus: { in: ["FAILED", "PENDING"] }, createdAt: { gte: new Date(now.getTime() - 7 * DAY), lt: new Date(now.getTime() - HOUR) } },
  });
  if (count === 0) return [pass(key)];
  return [{ key, ok: false, severity: "CRITICAL", title: `${count} פניות מהאתר בשבוע האחרון לא הגיעו ל-info@ (שמורות בטבלת website_leads)` }];
}

/// Drive files that should be gone and are still not, after three nights.
export async function driveDeletionCheck(): Promise<CheckResult[]> {
  const key = "drive-deletions-stuck";
  const count = await prisma.driveFileDeletion.count({ where: { attempts: { gte: 3 } } });
  if (count === 0) return [pass(key)];
  return [{ key, ok: false, severity: "WARNING", title: `${count} קובצי שמע שהיו צריכים להימחק עדיין ב-Drive אחרי שלושה לילות` }];
}

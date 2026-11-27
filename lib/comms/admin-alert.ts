import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { outgoingOf } from "@/lib/i18n/recipients";
import type { OutgoingT } from "@/lib/i18n/outgoing";

/// Not 24 hours: a nightly job alerts at about the same minute each night,
/// and a 24 hour window skipped every second night by a few seconds.
const ALERT_EVERY_MS = 20 * 60 * 60 * 1000;

/// A communications failure the admins must hear about (24.11.2026: Aloha
/// changed its template, and a disconnected WhatsApp number stopped the
/// nightly run, both in silence). Every admin gets a notification and an
/// email, in their own language, at most once a day for the same
/// (type, subject), so a day of failures is one alert and not one per try.
export async function alertAdmins(input: {
  type: string;
  /// What the alert is about (an email id, a channel id). The daily limit is per subject.
  subjectId: string;
  entityType: string;
  render: (t: OutgoingT) => { title: string; body: string };
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const admins = await prisma.user.findMany({
    where: { role: { in: ["SUPER_ADMIN", "ANKORA_ADMIN"] }, status: "ACTIVE", deletedAt: null },
    select: { id: true, email: true, locale: true, timezone: true },
  });
  const recent = new Set(
    (
      await prisma.notification.findMany({
        // Only an alert that reached the admin counts (27.11.2026): one whose
        // email failed used to block the next try for a whole day.
        where: {
          type: input.type,
          entityId: input.subjectId,
          createdAt: { gte: new Date(now.getTime() - ALERT_EVERY_MS) },
          emailedAt: { not: null },
        },
        select: { userId: true },
      })
    ).map((n) => n.userId),
  );
  for (const admin of admins.filter((a) => !recent.has(a.id))) {
    const { title, body } = input.render(outgoingOf(admin).t);
    const notification = await prisma.notification.create({
      data: { userId: admin.id, type: input.type, title, body, entityType: input.entityType, entityId: input.subjectId, createdAt: now },
    });
    if (!admin.email) continue;
    // A failed send is reported by sendEmail itself, as an email issue.
    const sent = await sendEmail({ to: [admin.email], subject: `Ankora - ${title}`, text: body });
    if (sent.ok) await prisma.notification.update({ where: { id: notification.id }, data: { emailedAt: now } });
  }
}

import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { outgoingOf } from "@/lib/i18n/recipients";
import type { OutgoingT } from "@/lib/i18n/outgoing";

const DAY_MS = 24 * 60 * 60 * 1000;

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
        where: { type: input.type, entityId: input.subjectId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
        select: { userId: true },
      })
    ).map((n) => n.userId),
  );
  for (const admin of admins.filter((a) => !recent.has(a.id))) {
    const { title, body } = input.render(outgoingOf(admin).t);
    await prisma.notification.create({
      data: { userId: admin.id, type: input.type, title, body, entityType: input.entityType, entityId: input.subjectId },
    });
    if (admin.email) await sendEmail({ to: [admin.email], subject: `Ankora - ${title}`, text: body });
  }
}

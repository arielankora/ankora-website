"use server";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { domainErrorText } from "@/lib/i18n/domain-errors";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError, assertCan } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { checkClientMessage, recordClientMessage, type MessageChannel, type MessageKind } from "@/lib/app-domain/client-messages";
import { sendEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

// The one write behind the "הודעה ללקוח" button, from anywhere.
//
// Its own file rather than a screen's actions.ts, because the button is
// meant to be mountable on any screen and an action that lives inside
// one screen's folder quietly becomes that screen's.
//
// Two jobs, in this order: send if the channel is email, and record
// either way. WhatsApp and the clipboard do not send from here - the
// person sends them, in WhatsApp or wherever they pasted it - so for
// those this action is only the record. That asymmetry is the rule
// itself: the product never becomes the sender unless somebody pressed
// a button that says send.

export async function recordClientMessageAction(input: {
  clientId: string;
  taskId: string | null;
  kind: string;
  channel: MessageChannel;
  subject: string;
  body: string;
}) {
  const user = await requireUser();
  const t = await getTranslations("clients.page.errors");
  try {
    assertCan(user.role, "time_entry.create_self");

    const accessible = await listAccessibleClients(user);
    if (!accessible.some((c) => c.id === input.clientId)) {
      throw new ForbiddenError("You are not assigned to this client.");
    }

    // The refusals first: once the email is out it cannot be taken back.
    await checkClientMessage(input);

    if (input.channel === "email") {
      const recipients = await prisma.clientUser.findMany({
        where: {
          clientId: input.clientId,
          role: "ADMIN",
          user: { deletedAt: null, status: { in: ["ACTIVE", "INVITED"] } },
        },
        select: { user: { select: { email: true } } },
      });
      if (recipients.length === 0) {
        return { ok: false as const, error: t("noPortalUser") };
      }
      // Plain text, exactly as the person wrote it. The invite and the
      // decision mails render a styled template because they are the
      // product speaking; this one is a person speaking, and dressing it
      // in a branded frame would make it the thing the rule is against.
      const result = await sendEmail({
        to: recipients.map((r) => r.user.email),
        subject: input.subject,
        text: input.body,
      });
      if (!result.ok) {
        // Not recorded: a message that failed to send is not a message
        // that was sent, and a log that says otherwise is worse than no
        // log.
        return { ok: false as const, error: t("emailNotSent") };
      }
    }

    try {
      await recordClientMessage(user, {
        clientId: input.clientId,
        taskId: input.taskId,
        kind: input.kind as MessageKind,
        channel: input.channel,
        body: input.body,
      });
    } catch (err) {
      // Sent but not recorded (27.11.2026). The client already has the
      // email, so this is not a failure to send: saying it was invited a
      // second try and a second copy of the same email.
      if (input.channel !== "email") throw err;
      console.error("client message: email sent, record failed", { clientId: input.clientId, taskId: input.taskId }, err);
      return { ok: true as const, warning: t("sentNotRecorded") };
    }

    if (input.taskId) revalidatePath(`/app/tasks/${input.taskId}`);
    revalidatePath(`/app/clients/${input.clientId}`);
    return { ok: true as const };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { ok: false as const, error: t("forbiddenNotAssigned") };
    }
    return { ok: false as const, error: (await domainErrorText(err)) ?? (err instanceof Error ? err.message : t("generic")) };
  }
}

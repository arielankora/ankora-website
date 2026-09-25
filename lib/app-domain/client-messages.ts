import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import type { ComposerProps } from "@/components/app/MessageClient";
import type { User } from "@prisma/client";

// A person sends. The system never does.
//
// Ariel, 25.9.2026: nothing goes out to a client automatically unless he
// set it up by hand. What is wanted instead is a button, everywhere
// there is a reason to write to somebody, that opens a message already
// written and lets the person fix it and send it.
//
// The rule is not only a preference, and this file is the place to say
// why. The whole promise of the brand is that a client feels somebody is
// looking after them. A message sent by a system reads like a message
// sent by a system, which is the opposite. And the SOP book is not
// asking for automation either: "אין בעיה שמזיקה לאמון כמו שתיקה" is
// followed immediately by what to say and when, which is judgement about
// timing rather than a schedule. A tool that writes the draft and leaves
// the sending to a person serves both.
//
// So: the templates here produce TEXT. Nothing in this file sends
// anything. The screen offers three ways out - WhatsApp with the message
// ready, the clipboard, and email - and a person presses one of them.
//
// See claude/client-communication-rule-2026-09-25.md.

export type MessageKind =
  | "decision_waiting"
  | "summary_ready"
  | "promise_update"
  | "promise_done"
  | "need_information"
  | "delay"
  | "handover";

export type MessageContext = {
  clientName: string;
  /// The person the client actually talks to, when the client record
  /// names one. Used for the sign-off, because a message signed by a
  /// company is a message from a system again.
  fromName: string;
  /// What the client calls this piece of work: `clientTitle` where there
  /// is one, and the internal title only as a fallback. Never a task id
  /// and never our own shorthand.
  subject?: string | null;
  /// The sentence that closes a promise, which is already written in the
  /// client's language because the product refuses to close one without
  /// it.
  outcome?: string | null;
  /// The portal's base address. Each draft appends its own path, so
  /// nothing here has to know that decisions live one level down.
  portalUrl?: string | null;
};

export type MessageDraft = {
  kind: MessageKind;
  /// What the button says. Short, and about the situation rather than
  /// about the message: somebody is choosing what happened, not what to
  /// write.
  label: string;
  /// Only used by email. WhatsApp has no subject, and a message written
  /// for WhatsApp with a subject line pasted on top reads as a forwarded
  /// email.
  emailSubject: string;
  body: string;
};

/// The drafts, in the voice the portal already speaks.
///
/// Short sentences, no exclamation marks, no "!היי" and no apology that
/// stretches over two lines. The brand is calm and discreet, and a
/// message a person has to strip down before sending is a template that
/// costs more than it saves.
///
/// Each one leaves exactly one thing for the person to fill in or fix,
/// and says so with a bracketed placeholder where the product genuinely
/// cannot know the answer. A draft that pretends to know is worse than a
/// blank: it gets sent.
export function buildMessage(kind: MessageKind, ctx: MessageContext): MessageDraft {
  const who = ctx.fromName;
  const about = ctx.subject?.trim() || null;
  const base = ctx.portalUrl?.trim().replace(/\/+$/, "") || null;
  const link = (path: string) => (base ? `\n\n${base}${path}` : "");

  switch (kind) {
    case "decision_waiting":
      return {
        kind,
        label: "משהו מחכה להחלטה",
        emailSubject: "משהו מחכה להחלטה שלך",
        body:
          `היי,\n\n` +
          `יש החלטה אחת שמחכה לך${about ? ` בנושא ${about}` : ""}. ` +
          `ריכזנו את האפשרויות והמחירים, ויש גם המלצה שלנו.\n\n` +
          `אפשר לאשר בלחיצה אחת, ואפשר לענות לי כאן אם עדיף לדבר על זה.${link("/decisions")}\n\n` +
          `${who}`,
      };

    // The other moment where something became available to the client
    // and nobody told them. Approving a monthly summary publishes it to
    // the portal; until 25.9.2026 the button said "שליחה", which was
    // the screen describing a send that never happened.
    case "summary_ready":
      return {
        kind,
        label: "הסיכום החודשי מוכן",
        emailSubject: about ? `הסיכום של ${about}` : "הסיכום החודשי",
        body:
          `היי,\n\n` +
          `הסיכום${about ? ` של ${about}` : " החודשי"} מוכן וממתין לך בפורטל. ` +
          `הוא מרכז מה נעשה החודש ואיפה הושקעו השעות.\n\n` +
          `אם משהו שם לא מסתדר, אני כאן.${link("")}\n\n` +
          `${who}`,
      };

    case "promise_update":
      return {
        kind,
        label: "עדכון באמצע",
        emailSubject: about ? `עדכון: ${about}` : "עדכון",
        body:
          `היי,\n\n` +
          `רק שתדע${about ? ` מה קורה עם ${about}` : ""}: [מה קורה עכשיו].\n\n` +
          `[מה הצעד הבא ומתי]. אין צורך לעשות כלום מצידך.\n\n` +
          `${who}`,
      };

    case "promise_done":
      return {
        kind,
        label: "סיימנו",
        emailSubject: about ? `הושלם: ${about}` : "הושלם",
        body:
          `היי,\n\n` +
          (ctx.outcome?.trim()
            ? `${ctx.outcome.trim()}\n\n`
            : `${about ? `${about} ` : ""}הושלם. [מה בדיוק נעשה].\n\n`) +
          `יש משהו נוסף שנוכל להוריד ממך?\n\n` +
          `${who}`,
      };

    case "need_information":
      return {
        kind,
        label: "צריך משהו ממך",
        emailSubject: about ? `צריך פרט אחד: ${about}` : "צריך פרט אחד",
        body:
          `היי,\n\n` +
          `כדי להתקדם${about ? ` עם ${about}` : ""} חסר לנו דבר אחד: [מה חסר].\n\n` +
          `ברגע שיהיה לנו, אנחנו ממשיכים משם.\n\n` +
          `${who}`,
      };

    case "delay":
      // The book's rule, in one message: the client hears it from us
      // before they notice it themselves, and we take the handling
      // rather than explain whose fault it is.
      return {
        kind,
        label: "יש עיכוב",
        emailSubject: about ? `עדכון על לוח הזמנים: ${about}` : "עדכון על לוח הזמנים",
        body:
          `היי,\n\n` +
          `רציתי לעדכן לפני שתשים לב בעצמך: ${about ? `${about} ` : ""}מתעכב. [למה, במשפט].\n\n` +
          `המועד המעודכן הוא [מתי], ואני מלווה את זה עד הסוף.\n\n` +
          `${who}`,
      };

    case "handover":
      return {
        kind,
        label: "מסירה",
        emailSubject: about ? `מסירה: ${about}` : "מסירה",
        body:
          `היי,\n\n` +
          `${about ? `${about} ` : ""}מוכן ומועבר אליך. מה שכלול: [מה בוצע, אישורים, קישורים].\n\n` +
          `[נקודות שחשוב לזכור להמשך].\n\n` +
          `יש משהו נוסף שנוכל להוריד ממך?\n\n` +
          `${who}`,
      };
  }
}

export const MESSAGE_KINDS: MessageKind[] = [
  "decision_waiting",
  "summary_ready",
  "promise_update",
  "promise_done",
  "need_information",
  "delay",
  "handover",
];

/// The product does NOT guess which channel the client wants.
///
/// The obvious version of this function read `preferenceContact` and
/// returned "whatsapp" or "email". It was written, and a test killed it
/// on its first run: "וואטסאפ בלבד, לא מיילים" contains the word מייל,
/// so the matcher answered email - on the one sentence in the whole
/// field that says the opposite in the clearest possible terms.
///
/// That is not a bug in the matcher, it is the matcher. `preferenceContact`
/// is free text a client wrote about how they want to be treated, and
/// the failure mode of parsing it is reaching for a channel they
/// explicitly asked us not to use. There is a `preferenceNever` field
/// beside it for exactly that reason.
///
/// So nothing is parsed. The composer SHOWS the client's own sentence,
/// above the buttons, to the person who is about to write to them, and
/// the person reads it. The channels are offered in a fixed order,
/// WhatsApp first, because that is where this company's clients are.
///
/// This is the smaller feature and the better one: it cannot be wrong,
/// and it puts the client's words in front of somebody rather than
/// behind a boolean.

/// `wa.me` wants digits, with a country code and nothing else.
///
/// Israeli numbers are written half a dozen ways and every one of them
/// is what somebody typed into the client record: 050-1234567,
/// +972 50 123 4567, 00972501234567. A link built from the raw string
/// opens WhatsApp on a number that does not exist, which is worse than
/// no button because it looks like it worked.
export function whatsappDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  // Shortest real mobile here is 972 plus nine digits. Anything shorter
  // is a partial number somebody meant to finish typing.
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/// What was said to the client, kept where somebody can find it.
///
/// Without this the whole feature is a text box: the message leaves in
/// WhatsApp on somebody's phone and the product never knows it happened.
/// "מה אמרנו ללקוח" is then answerable only by asking the person who
/// wrote it, which is the mental load this company exists to remove.
///
/// Two records, deliberately:
///
///   - an audit event on the client, so a message sent from anywhere is
///     findable in one place,
///   - and, when the message came from a task, a comment on that task's
///     thread, because that is where the next person looks.
///
/// The body is stored as sent, after the person edited it. Storing the
/// template would be storing what we offered rather than what we said.
export async function recordClientMessage(
  actor: User,
  input: { clientId: string; taskId?: string | null; kind: MessageKind; channel: MessageChannel; body: string }
) {
  const body = input.body.trim();
  if (!body) throw new Error("אין מה לשמור: ההודעה ריקה.");

  await recordAudit({
    actorId: actor.id,
    action: "client.message_sent",
    entityType: "Client",
    entityId: input.clientId,
    clientId: input.clientId,
    after: { kind: input.kind, channel: input.channel, taskId: input.taskId ?? null, length: body.length },
  });

  if (input.taskId) {
    await prisma.taskComment.create({
      data: {
        taskId: input.taskId,
        authorId: actor.id,
        // Prefixed so the thread reads as what happened rather than as
        // an internal note somebody wrote to themselves. The thread
        // shows comments verbatim, and "היי, רק שתדע" with no frame
        // would read as a message to a colleague.
        body: `${CHANNEL_LABELS[input.channel]} ללקוח:\n\n${body}`,
      },
    });
  }
}

export type MessageChannel = "whatsapp" | "email" | "copied";

const CHANNEL_LABELS: Record<MessageChannel, string> = {
  whatsapp: "נשלח בוואטסאפ",
  email: "נשלח במייל",
  copied: "הועתק ונשלח",
};

/// Everything the composer needs, gathered once.
///
/// Mounting the button on a screen was eleven lines of prisma and a map
/// over MESSAGE_KINDS, and the first two screens to want it would have
/// copied them. Two copies of a query that reads `preferenceNever` is
/// two places for the field to be forgotten, and the whole point of that
/// field is that it is never forgotten.
///
/// So the screen asks for the props and mounts them:
///
///     const composer = await messageComposerProps({ clientId, fromName: user.name });
///     {composer && <MessageClient clientId={id} {...composer} />}
///
/// It reads nothing about the actor's access on purpose. Every screen
/// that mounts this has already decided the person may see this client,
/// and a second, weaker check here would only disagree with the first.
export async function messageComposerProps(input: {
  clientId: string;
  /// The person who will press send, for the sign-off.
  fromName: string;
  /// What the client calls this piece of work, where the screen knows.
  /// The client screen does not, and leaving it out is correct there:
  /// the draft then talks about the client rather than about a task.
  subject?: string | null;
  outcome?: string | null;
  portalUrl?: string | null;
}): Promise<ComposerProps | null> {
  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: {
      name: true,
      whatsappNumber: true,
      preferenceContact: true,
      preferenceNever: true,
      portalUsers: {
        // The client's own admins, and only the ones who could actually
        // read it: a deleted or suspended user's address is a bounce
        // with somebody's name on it.
        where: { role: "ADMIN", user: { deletedAt: null, status: { in: ["ACTIVE", "INVITED"] } } },
        select: { user: { select: { email: true } } },
      },
    },
  });
  if (!client) return null;

  return {
    clientName: client.name,
    preference: client.preferenceContact,
    never: client.preferenceNever,
    whatsappDigits: whatsappDigits(client.whatsappNumber),
    emails: client.portalUsers.map((p) => p.user.email),
    drafts: MESSAGE_KINDS.map((kind) =>
      buildMessage(kind, {
        clientName: client.name,
        fromName: input.fromName,
        subject: input.subject,
        outcome: input.outcome,
        portalUrl: input.portalUrl,
      })
    ),
  };
}

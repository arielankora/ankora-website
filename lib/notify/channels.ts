import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { renderActionEmail } from "@/lib/email-templates";
import {
  type ChannelId,
  type DeliveryPolicy,
  type OutboundMessage,
  type Recipient,
  planDelivery,
} from "@/lib/notify/policy";

// The way a message to a colleague leaves the building.
//
// Ariel, 7.10.2026: "כרגע אין מספר ווצאפ יעודי וההודעה תצא מיידית מהמייל.
// תבנה את הקוד ככה שבעתיד נוכל לחבר ווצאפ ו/או מייל."
//
// So the caller never names a channel. It builds one message, says which
// policy it is under, and this module decides how the message travels.
// Today that is always email. The day a WhatsApp number exists, the
// change is one implementation below and one environment variable, and
// no caller is touched.
//
// Internal, to the team. The rule Ariel set on 25.9 is about clients,
// and nothing here reaches one: every recipient is resolved from a User
// row with a staff role by the caller.

export interface SendOutcome {
  ok: boolean;
  error?: string;
}

export interface DeliveryChannel {
  id: ChannelId;
  /// Whether this channel can send at all in this deployment.
  configured(): boolean;
  /// Whether this channel can reach this particular person.
  reaches(recipient: Recipient): boolean;
  send(recipient: Recipient, message: OutboundMessage): Promise<SendOutcome>;
}

/// Email, through the same Resend adapter and the same layout as every
/// other transactional message.
///
/// It carries `detail`. An email to a colleague's work address is where
/// the morning digest already quotes comments, so the urgent message
/// saying the same thing an hour earlier adds no new exposure.
const emailChannel: DeliveryChannel = {
  id: "email",
  configured: () => Boolean(process.env.RESEND_API_KEY),
  reaches: (r) => Boolean(r.email),
  async send(r, m) {
    const body = [...m.lines];
    if (m.detail) body.push(`«${m.detail}»`);
    const { html, text } = renderActionEmail({ title: m.title, body, buttonLabel: m.buttonLabel, url: m.url });
    const result = await sendEmail({ to: [r.email as string], subject: m.subject, text, html });

    // Logged like every other alert, so a failure is visible and the
    // existing retry can resend the same words rather than a stub.
    try {
      await prisma.emailDelivery.create({
        data: {
          template: m.template,
          recipients: [r.email as string],
          subject: m.subject,
          body: text,
          status: result.ok ? "SENT" : "FAILED",
          providerMessageId: result.providerMessageId ?? null,
          error: result.error ?? null,
        },
      });
    } catch (err) {
      console.error("email delivery log failed:", err);
    }
    return { ok: result.ok, error: result.error };
  },
};

/// WhatsApp, not connected yet.
///
/// What connecting it means, so the next person does not have to
/// rediscover it (claude/whatsapp-integration-2026-09.md has the why):
///
///   1. A separate number on Ankora's Business Manager, on the Cloud API,
///      used only for alerts to the team. Not the main number: moving
///      that one to the API is a one-way decision still open.
///   2. One Utility template approved by Meta. A message that is not an
///      approved template cannot open a conversation.
///   3. A phone column on User and a consent toggle on the profile.
///      `Recipient.phone` stays null until then, so `reaches` is false.
///   4. Implement `send` against the Cloud API, return `configured`
///      from its environment variables, and set
///      URGENT_TASK_CHANNELS="whatsapp,email".
///
/// It must NOT carry `message.detail`. A comment can hold a client's
/// amounts, document numbers or health details, and a WhatsApp message
/// passes through Meta and stays on a phone. The title, the client, who
/// sent it and the link are enough to make somebody open the task.
const whatsappChannel: DeliveryChannel = {
  id: "whatsapp",
  configured: () => false,
  reaches: (r) => Boolean(r.phone),
  async send() {
    return { ok: false, error: "WhatsApp is not connected" };
  },
};

export const CHANNELS: Record<ChannelId, DeliveryChannel> = {
  email: emailChannel,
  whatsapp: whatsappChannel,
};

export type DeliveryResult = { channel: ChannelId; ok: boolean; error?: string }[];

/// Sends one message to one person under a policy. Never throws.
///
/// "first": the channels in order, stopping at the first that delivers.
/// A failure moves on to the next one, which is what makes email the
/// fallback the day WhatsApp is first.
/// "all": every channel that can reach the person.
export async function deliver(
  recipient: Recipient,
  message: OutboundMessage,
  policy: DeliveryPolicy,
  registry: Record<ChannelId, DeliveryChannel> = CHANNELS
): Promise<DeliveryResult> {
  const plan = planDelivery(
    policy,
    Object.values(registry).map((c) => ({ id: c.id, configured: c.configured(), reaches: c.reaches(recipient) }))
  );
  const results: DeliveryResult = [];
  for (const id of plan) {
    let outcome: SendOutcome;
    try {
      outcome = await registry[id].send(recipient, message);
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    results.push({ channel: id, ...outcome });
    if (outcome.ok && policy.mode === "first") break;
  }
  if (results.length === 0) {
    console.warn(`no channel reaches user ${recipient.userId} for ${message.template}`);
  }
  return results;
}

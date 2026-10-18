// The pure half of lib/notify/channels.ts: what a message is, who it
// goes to, and which channels to try in which order. No imports, so it
// is testable without the send path, the database or the environment.

export type ChannelId = "email" | "whatsapp";

export const CHANNEL_IDS: readonly ChannelId[] = ["email", "whatsapp"];

export interface Recipient {
  userId: string;
  name: string;
  email: string | null;
  /// Null for everyone until WhatsApp is connected. See the note on the
  /// WhatsApp channel in channels.ts.
  phone: string | null;
}

/// One message, written once, in a shape every channel can render.
export interface OutboundMessage {
  /// Stable key for logs and the delivery table. "task_urgent".
  template: string;
  /// Email subject. Read on a phone without opening, so it carries the
  /// answer, not a teaser.
  subject: string;
  /// The heading.
  title: string;
  /// Short facts that are safe on every channel: the task, the client,
  /// who, when.
  lines: string[];
  /// Quoted content (a comment, a description). Only channels that are
  /// private enough carry it; see the WhatsApp note in channels.ts.
  detail?: string | null;
  url: string;
  buttonLabel: string;
}

export interface DeliveryPolicy {
  channels: ChannelId[];
  mode: "first" | "all";
}

/// Email only, until somebody decides otherwise in the environment.
export const DEFAULT_URGENT_POLICY: DeliveryPolicy = { channels: ["email"], mode: "first" };

/// Reads a policy from two environment strings.
///
/// `channels` is a comma list in order of preference ("whatsapp,email").
/// Unknown names are dropped rather than fatal: a typo in a Vercel
/// setting must degrade to the default, never to silence. An empty
/// result falls back to the default for the same reason.
export function policyFromEnv(channels: string | undefined, mode: string | undefined): DeliveryPolicy {
  const parsed = (channels ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ChannelId => (CHANNEL_IDS as readonly string[]).includes(s));
  const unique = [...new Set(parsed)];
  return {
    channels: unique.length > 0 ? unique : DEFAULT_URGENT_POLICY.channels,
    mode: mode?.trim().toLowerCase() === "all" ? "all" : "first",
  };
}

/// Which channels to try, in order: the policy's order, keeping only the
/// ones that are configured here and can reach this person.
export function planDelivery(
  policy: DeliveryPolicy,
  available: { id: ChannelId; configured: boolean; reaches: boolean }[]
): ChannelId[] {
  return policy.channels.filter((id) => {
    const c = available.find((a) => a.id === id);
    return Boolean(c && c.configured && c.reaches);
  });
}

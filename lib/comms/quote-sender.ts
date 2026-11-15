/// Who wrote the message a WhatsApp reply quotes (15.11.2026).
///
/// WhatsApp hides the number of whoever wrote a quoted message, and Unipile
/// passes that on as the quote's sender name: "+1••••••••90". It means
/// nothing to a person, and it is not even a name. So the quote's own name
/// is the last thing to trust:
/// - the original message is in the conversation: it says who wrote it;
/// - a one to one conversation has two sides: if it is not us, it is them;
/// - a hidden number is matched against the conversation's number, the
///   only number we know;
/// - otherwise no name at all, rather than a row of dots.
/// The screen and the connector (get_client_communication) both use it.

export type QuoteSender =
  | { kind: "us" }
  | { kind: "name"; name: string }
  /// We cannot tell who wrote it: say "a reply" without a name.
  | { kind: "unknown" };

export type QuoteSenderInput = {
  /// The name that came with the quote (Unipile's quoted.sender.display_name).
  quotedName: string | null;
  /// The quoted message itself, when it is in the conversation.
  original: { isSender: boolean; senderName: string | null } | null;
  isGroup: boolean;
  chatName: string;
  /// The other side's number, in a one to one conversation.
  chatPhone: string | null;
};

const MASK = /[•·∙●*]/;

/// A number WhatsApp hid, such as "+1••••••••90" or "+972 ••• 5088".
export function isMaskedPhone(name: string | null | undefined): boolean {
  if (!name) return false;
  const compact = name.replace(/[\s\-()]/g, "");
  return MASK.test(compact) && /^\+?\d*[•·∙●*]+\d*$/.test(compact);
}

/// The hidden number could be this one: its visible digits are where they
/// should be, and when every digit has a place, the lengths agree.
export function maskedPhoneMatches(masked: string, phone: string): boolean {
  const compact = masked.replace(/[\s\-()+]/g, "");
  const m = /^(\d*)([•·∙●*]+)(\d*)$/.exec(compact);
  const digits = phone.replace(/\D/g, "");
  if (!m || !digits) return false;
  const [, head, dots, tail] = m;
  if (!head && !tail) return false;
  if (!digits.startsWith(head) || !digits.endsWith(tail)) return false;
  // "+972 ••• 5088" stands for any number of digits; one dot a digit does not.
  const perDigit = dots.length > 3;
  return perDigit ? head.length + dots.length + tail.length === digits.length : head.length + tail.length <= digits.length;
}

function usable(name: string | null | undefined): string | null {
  const n = name?.trim();
  return n && !isMaskedPhone(n) ? n : null;
}

export function quoteSender(input: QuoteSenderInput): QuoteSender {
  const { quotedName, original, isGroup, chatName, chatPhone } = input;
  if (original) {
    if (original.isSender) return { kind: "us" };
    if (!isGroup) return { kind: "name", name: chatName };
    const name = usable(original.senderName) ?? usable(quotedName);
    return name ? { kind: "name", name } : { kind: "unknown" };
  }
  const name = usable(quotedName);
  if (name) return { kind: "name", name };
  if (isGroup) return { kind: "unknown" };
  if (!quotedName?.trim()) return { kind: "name", name: chatName };
  // A hidden number in a one to one conversation. Theirs when it matches
  // their number; otherwise probably ours, but a guess is not shown.
  return chatPhone && maskedPhoneMatches(quotedName, chatPhone) ? { kind: "name", name: chatName } : { kind: "unknown" };
}

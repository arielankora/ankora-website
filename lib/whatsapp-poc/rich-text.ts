// WhatsApp's text, as WhatsApp shows it (13.11.2026, Ariel: a bold word
// showed with its asterisks, a link could not be clicked, a mention showed
// as a number). Pure, so it is unit-tested on its own
// (tests/unit/whatsapp-rich-text.test.ts) and loads in the browser too.

export type RichNode =
  | { t: "text"; v: string }
  | { t: "link"; href: string; v: string }
  | { t: "mention"; v: string; userId: string | null }
  | { t: "b" | "i" | "s"; children: RichNode[] }
  | { t: "code"; v: string };

const MARKERS: Record<string, "b" | "i" | "s"> = { "*": "b", _: "i", "~": "s" };
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
/// What may stand next to a marker: the start or end, a space, punctuation.
const EDGE = /[\s.,!?;:()[\]{}"'׳״\-]/;

function isEdge(ch: string | undefined): boolean {
  return ch === undefined || EDGE.test(ch);
}

/// Links in plain text. A link's trailing punctuation is left out of it,
/// as WhatsApp does ("ראו https://x.co/a." links "https://x.co/a").
function linkify(text: string): RichNode[] {
  const out: RichNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    let v = m[0];
    const trail = /[.,!?;:)\]'"]+$/.exec(v);
    if (trail) v = v.slice(0, -trail[0].length);
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: text.slice(last, at) });
    const href = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    out.push({ t: "link", href, v });
    last = at + v.length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/// *bold*, _italic_, ~strike~, ```code``` and `code`, nested as WhatsApp
/// allows, with links inside the plain parts.
export function parseFormatting(text: string): RichNode[] {
  const out: RichNode[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push(...linkify(plain));
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("```", i)) {
      const end = text.indexOf("```", i + 3);
      if (end > i + 3) {
        flush();
        out.push({ t: "code", v: text.slice(i + 3, end) });
        i = end + 3;
        continue;
      }
    }
    const ch = text[i];
    if (ch === "`" && isEdge(text[i - 1])) {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1 && !text.slice(i + 1, end).includes("\n") && isEdge(text[end + 1])) {
        flush();
        out.push({ t: "code", v: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    const kind = MARKERS[ch];
    if (kind && isEdge(text[i - 1]) && text[i + 1] !== undefined && !/\s/.test(text[i + 1])) {
      // The closing marker: on the same line, after a non-space, before an edge.
      let end = -1;
      for (let j = i + 2; j < text.length && text[j] !== "\n"; j++) {
        if (text[j] === ch && !/\s/.test(text[j - 1]) && isEdge(text[j + 1])) {
          end = j;
          break;
        }
      }
      if (end > 0) {
        flush();
        out.push({ t: kind, children: parseFormatting(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    plain += ch;
    i += 1;
  }
  flush();
  return out;
}

/// The whole text: mentions first (Unipile gives their place in it), then
/// formatting and links in what is between them.
export function parseWhatsappText(
  text: string,
  mentions: ReadonlyArray<{ start: number; length: number; userId: string | null }> = [],
): RichNode[] {
  const sorted = [...mentions]
    .filter((m) => m.start >= 0 && m.length > 0 && m.start + m.length <= text.length)
    .sort((a, b) => a.start - b.start);
  const out: RichNode[] = [];
  let last = 0;
  for (const m of sorted) {
    if (m.start < last) continue;
    if (m.start > last) out.push(...parseFormatting(text.slice(last, m.start)));
    out.push({ t: "mention", v: text.slice(m.start, m.start + m.length), userId: m.userId });
    last = m.start + m.length;
  }
  if (last < text.length) out.push(...parseFormatting(text.slice(last)));
  return out;
}

/// The digits of a WhatsApp id or a phone number ("972523494293@s.whatsapp.net").
export function phoneDigits(v: string | null | undefined): string | null {
  if (!v) return null;
  const digits = v.split("@")[0].replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

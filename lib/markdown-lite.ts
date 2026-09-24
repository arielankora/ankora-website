// A deliberately small Markdown subset, and the only one this product has.
//
// The tasks-system spec's decision 4: a task description, and later a task
// comment, is written in Markdown and stored as plain text. No editor is
// installed. Tiptap and ProseMirror are hundreds of kilobytes of bundle,
// carry known RTL problems in Hebrew, and become a maintenance surface
// forever - for a field whose whole job is to hold an address, a reference
// number and two sentences of context.
//
// What is supported, and nothing else:
//
//   **bold**        __bold__
//   *italic*        _italic_
//   `code`
//   - bullet        1. numbered
//   [text](https://…)
//   blank line      paragraph break
//
// What is deliberately not: headings, tables, images, block quotes, raw
// HTML. A person writing what happened with a supplier does not need a
// table, and every one of those is a rendering decision that would have to
// be made twice - once here and once in whatever reads these fields next.
//
// SECURITY. This module produces HTML that a browser will run. It is
// written to be read by somebody checking exactly that, so the order of
// operations matters and is stated:
//
//   1. Escape every HTML-special character in the WHOLE input, first.
//      After this line there is no way for author text to become a tag.
//   2. Only then apply the inline patterns, which emit a fixed set of
//      tags this file writes itself.
//   3. Links carry an href taken from the author's text, so that value is
//      re-checked on its own: http and https only, and the URL is escaped
//      again for an attribute context. A `javascript:` href is the one
//      way a link can execute, so it is not a case to handle carefully,
//      it is a case to drop.
//
// Anything that does not match a pattern survives as escaped text, which
// is the correct failure: a person sees the characters they typed.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/// http and https only, and nothing that is merely shaped like a URL.
/// Returns null for anything else, and the caller renders the link text
/// as plain text rather than a dead or dangerous anchor.
function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  // The escape pass has already turned & into &amp; and " into &quot;.
  // Parsing has to happen on the real characters, so they come back here
  // and the result is escaped again on the way into the attribute.
  const decoded = trimmed.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return escapeHtml(url.toString());
}

/// Inline patterns, applied to text that is ALREADY html-escaped.
///
/// Code spans are lifted out FIRST and put back LAST. Replacing them in
/// place is not enough: the bold and italic passes that follow would run
/// straight over the text inside the tag this function just emitted, so
/// `` `**x**` `` came back as bold inside a code span instead of the four
/// characters somebody typed. Lifting them out is the only version where
/// "code means literal" is actually true.
///
/// The placeholder uses characters the escape pass has already removed
/// from the input (\u0000), so author text cannot forge one.
function inline(escaped: string): string {
  const codes: string[] = [];
  const withoutCode = escaped.replace(/`([^`\n]+)`/g, (_whole, body: string) => {
    codes.push(body);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  const rendered = applyInline(withoutCode);

  return rendered.replace(
    /\u0000C(\d+)\u0000/g,
    (_whole, index: string) =>
      `<code class="rounded bg-appNavy/[0.06] px-1 py-0.5 text-[0.92em]">${codes[Number(index)]}</code>`
  );
}

function applyInline(escaped: string): string {
  return (
    escaped
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, text: string, href: string) => {
        const safe = safeHref(href);
        if (!safe) return text;
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer nofollow" class="text-gold-dim underline underline-offset-2 hover:text-appNavy">${text}</a>`;
      })
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>")
  );
}

const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;

/// Render the subset above to HTML. The input is author text; the output
/// is safe to place with dangerouslySetInnerHTML, which is the only
/// reason this function exists rather than a library call.
export function renderMarkdownLite(source: string): string {
  const escaped = escapeHtml(source.replace(/\r\n/g, "\n"));
  const lines = escaped.split("\n");

  const out: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  function closeParagraph() {
    if (paragraph.length === 0) return;
    // Each line is rendered on its own and the breaks are inserted
    // after. Joining first and rendering once would let emphasis run
    // across a line break: the \n that stops the `[^*\n]+` patterns is
    // gone by then, so a stray asterisk at the end of one line would pair
    // with one three lines down and italicise everything between them.
    out.push(`<p>${paragraph.map(inline).join("<br />")}</p>`);
    paragraph = [];
  }
  function closeList() {
    if (!listKind) return;
    out.push(`</${listKind}>`);
    listKind = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      closeParagraph();
      closeList();
      continue;
    }

    const bullet = trimmed.match(BULLET);
    const numbered = bullet ? null : trimmed.match(NUMBERED);

    if (bullet || numbered) {
      closeParagraph();
      const kind = bullet ? "ul" : "ol";
      if (listKind !== kind) {
        closeList();
        out.push(kind === "ul" ? '<ul class="list-disc space-y-1 pr-5">' : '<ol class="list-decimal space-y-1 pr-5">');
        listKind = kind;
      }
      out.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  closeParagraph();
  closeList();
  return out.join("");
}

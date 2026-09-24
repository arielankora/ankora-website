import { describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdownLite } from "@/lib/markdown-lite";

// lib/markdown-lite.ts produces HTML that a browser executes, from text a
// colleague typed. That is the whole reason it exists rather than a
// library call, and it is the whole reason this file is longer than the
// feature deserves.
//
// The tests are grouped the way the module's own security note is: the
// escape pass comes first and nothing after it can undo it, then the
// patterns, then links, which are the one place an author's text becomes
// an attribute a browser acts on.

describe("nothing an author types becomes a tag", () => {
  it("escapes the characters that open one", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });

  it("renders a script tag as the characters somebody typed", () => {
    const html = renderMarkdownLite("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not let an img tag carry an onerror handler", () => {
    const html = renderMarkdownLite(`<img src=x onerror="alert(1)">`);
    // The handler's NAME survives, as the characters a person typed, and
    // that is the correct outcome: it is text in a paragraph, not an
    // attribute on an element. What must not survive is the element.
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&quot;alert(1)&quot;");
  });

  it("escapes a quote inside emphasis, where the pattern does fire", () => {
    const html = renderMarkdownLite(`**"שלום"**`);
    expect(html).toContain("<strong>&quot;שלום&quot;</strong>");
  });
});

describe("links: http and https, and nothing else", () => {
  it("renders an https link, opening it away from the app", () => {
    const html = renderMarkdownLite("[האתר](https://ankora.co.il/pricing)");
    expect(html).toContain('href="https://ankora.co.il/pricing"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("drops a javascript: href and keeps the words", () => {
    const html = renderMarkdownLite("[לחצו כאן](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain("לחצו כאן");
  });

  it("drops a data: href too", () => {
    const html = renderMarkdownLite("[x](data:text/html,<script>alert(1)</script>)");
    expect(html).not.toContain("data:text/html");
    expect(html).not.toContain("<a ");
  });

  it("drops something that is not a URL at all", () => {
    const html = renderMarkdownLite("[x](not a url)");
    expect(html).not.toContain("<a ");
  });

  it("survives a query string, which the escape pass turned into &amp;", () => {
    const html = renderMarkdownLite("[חיפוש](https://example.com/a?b=1&c=2)");
    // The attribute is escaped for its context; what matters is that both
    // parameters are still there and the URL was not truncated at the &.
    expect(html).toContain("b=1");
    expect(html).toContain("c=2");
    expect(html).toContain("<a ");
  });
});

describe("the subset that is supported", () => {
  it("renders bold, italic and code", () => {
    expect(renderMarkdownLite("**חשוב**")).toContain("<strong>חשוב</strong>");
    expect(renderMarkdownLite("טקסט *נטוי*")).toContain("<em>נטוי</em>");
    expect(renderMarkdownLite("`ABC-123`")).toContain("<code");
  });

  it("does not read emphasis across a line break", () => {
    // A stray asterisk on one line and another two lines down is a person
    // typing a bullet, not a person opening emphasis.
    const html = renderMarkdownLite("שורה *אחת\nשורה שתיים*");
    expect(html).not.toContain("<em>");
  });

  it("leaves code spans alone instead of reading markup inside them", () => {
    const html = renderMarkdownLite("`**לא מודגש**`");
    expect(html).not.toContain("<strong>");
  });

  it("renders a bullet list and a numbered list", () => {
    expect(renderMarkdownLite("- א\n- ב")).toContain("<ul");
    expect(renderMarkdownLite("1. א\n2. ב")).toContain("<ol");
  });

  it("closes one list before opening the other", () => {
    const html = renderMarkdownLite("- א\n1. ב");
    expect(html).toContain("</ul>");
    expect(html).toContain("<ol");
  });

  it("makes a blank line a paragraph break and a single break a line break", () => {
    const twoParagraphs = renderMarkdownLite("ראשון\n\nשני");
    expect(twoParagraphs.match(/<p>/g)).toHaveLength(2);

    const oneParagraph = renderMarkdownLite("ראשון\nשני");
    expect(oneParagraph.match(/<p>/g)).toHaveLength(1);
    expect(oneParagraph).toContain("<br />");
  });
});

describe("what is deliberately not supported", () => {
  it("does not render a heading, and does not eat the text either", () => {
    const html = renderMarkdownLite("# כותרת");
    expect(html).not.toContain("<h1");
    expect(html).toContain("# כותרת");
  });

  it("does not render a table", () => {
    const html = renderMarkdownLite("| a | b |\n| --- | --- |");
    expect(html).not.toContain("<table");
  });

  it("returns an empty string for empty input rather than an empty tag", () => {
    expect(renderMarkdownLite("")).toBe("");
    expect(renderMarkdownLite("   \n  \n")).toBe("");
  });
});

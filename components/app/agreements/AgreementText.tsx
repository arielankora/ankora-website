import { renderMarkdownLite } from "@/lib/markdown-lite";

// The body of an agreement, as the signer reads it before agreeing.
//
// markdown-lite deliberately has no headings, and the agreements are
// organised by numbered sections, so headings are split out here and
// everything between them goes through the one sanctioned renderer. The
// caller passes the body already reduced by agreementBody() and
// unescapeMarkdown(); this component decides layout only.
export function AgreementText({ body }: { body: string }) {
  const sections: { heading: string | null; text: string[] }[] = [{ heading: null, text: [] }];
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) sections.push({ heading: line.slice(3).trim(), text: [] });
    else sections[sections.length - 1].text.push(line);
  }

  return (
    <div className="space-y-5 text-[14px] leading-7 text-app-text-primary">
      {sections.map((section, i) => {
        const text = section.text.join("\n").trim();
        if (!section.heading && !text) return null;
        return (
          <section key={i}>
            {section.heading && <h2 className="mb-2 text-[15px] font-medium text-app-text-primary">{section.heading}</h2>}
            {text && (
              <div
                className="space-y-3"
                // renderMarkdownLite escapes its whole input before adding
                // its own fixed set of tags; the input is a versioned file
                // in this repository in any case.
                dangerouslySetInnerHTML={{ __html: renderMarkdownLite(text) }}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

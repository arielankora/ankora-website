import type { ReactNode } from "react";

/// "בלי AI" and the browser's translator (ADR 0006, 12.11.2026). People who
/// read client content in English use the browser's own translation
/// (Chrome's "Translate to English" and the like), not an in-app AI. That
/// is machine translation too: the page's text is sent to the browser
/// vendor's service. Material a client asked to keep away from AI
/// (lib/ai-exclusion.ts) must never go there.
///
/// When `active`, the children sit inside an element marked
/// translate="no", which every browser translator honours, and the page
/// gets <meta name="google" content="notranslate">, which tells Chrome not
/// to offer translating the page at all. React 19 hoists the <meta> into
/// <head>. The wrapper is `display: contents`, so it adds no box and
/// changes no layout.
///
/// For a whole page of one client or one task. On a page that lists items
/// of many clients, mark the excluded item's own element translate="no"
/// (`noTranslateProps`) and leave the page translatable.
///
/// Server safe: no hooks, no client code.
export function NoMachineTranslation({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return <>{children}</>;
  return (
    <>
      <meta name="google" content="notranslate" />
      <div translate="no" className="contents">
        {children}
      </div>
    </>
  );
}

/// The attribute for one item in a mixed list: spread it on the row or
/// card. Nothing when the item may be translated, so the markup of every
/// other row stays as it was.
export function noTranslateProps(excluded: boolean | null | undefined): { translate?: "no" } {
  return excluded ? { translate: "no" } : {};
}

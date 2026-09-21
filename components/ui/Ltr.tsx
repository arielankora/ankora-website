/**
 * An isolated left-to-right run inside Hebrew prose.
 *
 * Latin strings embedded in an RTL paragraph - "Personal Operations Management", "AI",
 * "3X CRO | Revenue Architect | GTM Advisor", a URL - are reordered by the bidi
 * algorithm at their edges: trailing punctuation jumps to the wrong side, and a string
 * containing a pipe or a slash can come out visually reversed. The bdi element isolates
 * the run so the surrounding Hebrew and the embedded Latin each resolve on their own.
 *
 * Used for customer roles, company names and evidence labels, which are the fields most
 * likely to be Latin inside a Hebrew page.
 */
export function Ltr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}

/**
 * Isolation WITHOUT a forced direction, for a field whose language follows the
 * dictionary: the customer's name, their company, the label on an evidence link. These
 * are Hebrew on /he and Latin on /en, so pinning them to LTR mirrors the Hebrew word
 * order. Plain bdi isolates the run from its surroundings and lets each value resolve
 * its own base direction.
 *
 * Rule of thumb: Ltr for values that are Latin in BOTH dictionaries (a job title like
 * "3X CRO | Revenue Architect | GTM Advisor", a source type like "LinkedIn"), Iso for
 * values that follow the page language.
 */
export function Iso({ children, className }: { children: React.ReactNode; className?: string }) {
  return <bdi className={className}>{children}</bdi>;
}

import { MonoLabel } from "@/components/ui/MonoLabel";

/**
 * The `בקצרה` block: the paragraph a model quotes and the paragraph a reader reads if
 * they read nothing else.
 *
 * It sits immediately below the hero and above the contents rail, and it is the only
 * content above the rail. Set in `cream` rather than body grey because it is the
 * answer, not the introduction — on a reference page the difference matters.
 *
 * Not a new primitive: `SectionShell` content with a modifier, named so the three SEO
 * pages do not each re-declare the same ground and rule.
 */
export function SummaryPanel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gold bg-navy-deep p-[clamp(20px,2.6vw,30px)]">
      <MonoLabel size={10} className="text-gold">
        {label}
      </MonoLabel>
      <p className="mt-3 max-w-[66ch] font-assistant text-[16px] font-light leading-[1.8] text-cream">
        {children}
      </p>
    </div>
  );
}

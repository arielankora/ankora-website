import { MonoLabel } from "@/components/ui/MonoLabel";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils";

/**
 * The reading engine for the three SEO pages and the blog post. One implementation,
 * four pages.
 *
 * A twenty-section reference page is a different instrument from the marketing pages:
 * those are short sections with a lot of air, and their 14–15px body is a caption size
 * that is punishing over 3,000 words on a dark ground. So: 17px, Assistant 300,
 * line-height 1.85, and a 64ch measure rather than the 68ch the legal pages use, which
 * are set in much shorter blocks. Light text on a dark ground blooms; the weight and
 * the measure are both answers to that.
 *
 * The rhythm has two levels rather than twenty equal ones. An h2 opens a movement, with
 * a hairline above it and a derived index beside it — never gold, because a gold number
 * on each of twenty headings is a gold number on nothing. An h3 subdivides quietly: no
 * hairline, no number, and a rule on the inline-start edge of the whole block so a
 * subsection reads as indented without an indent that breaks in RTL.
 *
 * Reveal is applied per section, never per paragraph. A twenty-section page that fades
 * in paragraph by paragraph reads as a page that is loading badly.
 */
export function LongFormSection({
  id,
  index,
  title,
  children,
}: {
  id: string;
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Reveal>
      <section id={id} className="mt-[clamp(52px,6vw,80px)] scroll-mt-[130px]">
        <div className="flex items-baseline gap-4 border-t border-[rgba(243,234,219,0.12)] pt-[22px]">
          <MonoLabel script="latin" tracking="0.1em" className="flex-none pt-1.5 text-muted">
            {String(index + 1).padStart(2, "0")}
          </MonoLabel>
          <h2 className="max-w-[24ch] text-[clamp(1.5rem,2.4vw,2.05rem)] font-extralight leading-[1.28] tracking-[-0.02em] text-cream">
            {title}
          </h2>
        </div>
        {children}
      </section>
    </Reveal>
  );
}

export function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "mt-[18px] max-w-[64ch] font-assistant text-[17px] font-light leading-[1.85] text-body",
        className
      )}
    >
      {children}
    </p>
  );
}

/**
 * Short parallel phrases — the eleven task types, the five audiences. An auto-fit grid
 * with outlined cells and no container background, so an incomplete last row leaves
 * gaps rather than a lit slab.
 */
export function ItemGrid({ items, minCell = 230 }: { items: string[]; minCell?: number }) {
  return (
    <ul
      className="mt-[23px] grid list-none gap-px p-0"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minCell}px), 1fr))` }}
    >
      {items.map((item) => (
        <li
          key={item}
          className="bg-navy px-4 py-3.5 font-assistant text-[15px] font-light leading-[1.55] text-body outline outline-1 outline-[rgba(243,234,219,0.11)]"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export function SubSection({
  title,
  quote,
  children,
}: {
  title: string;
  /** A short aside under the heading, set quieter than the body. */
  quote?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-[34px] border-s border-[rgba(243,234,219,0.14)] ps-[18px]">
      <h3 className="text-[1.18rem] font-normal leading-[1.35] text-cream">{title}</h3>
      {quote && (
        <p className="mt-2.5 font-assistant text-[15px] font-light leading-[1.6] text-muted">
          {quote}
        </p>
      )}
      {children}
    </div>
  );
}

import { Reveal } from "@/components/motion/Reveal";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { cn } from "@/lib/utils";

/**
 * Criterion · alternative · Ankora, as one real table.
 *
 * It is the one place in the system that draws its rules with `border-block-start` on
 * cells rather than with 1px grid gaps, and that is deliberate: table semantics have to
 * survive. The comparison page is an objection-handling page that search engines read
 * as a comparison, and `display: grid` on a table element throws that away. The visual
 * result is identical.
 *
 * One DOM, CSS switch. The previous version rendered the table *and* a full stacked
 * repeat of the same content for narrow screens — every criterion and value in the DOM
 * twice, so a screen reader heard the comparison twice and a crawler saw duplicated
 * body content on the page whose whole job is ranking for a comparison query. It also
 * carried a forked `locale === "he"` branch, which is the last of those on this page.
 *
 * The Ankora column is the only gold in the table: one rule under its header and the
 * header text in gold. That single rule is the table saying which column is the answer,
 * and it says it once. No icons — no ticks, no crosses. Both models are legitimate, the
 * page says so in its own lead, and a column of green ticks against a column of red
 * crosses contradicts the copy.
 */
export function ComparisonTable({
  columnA,
  columnB,
  criterionLabel,
  rows,
  stickyHeader,
}: {
  columnA: string;
  columnB: string;
  /** Header over the criterion column. */
  criterionLabel: string;
  rows: { dimension: string; a: string; b: string }[];
  /** Defaults to auto above 12 rows: a 16-row table is unreadable by row 12 otherwise. */
  stickyHeader?: boolean;
}) {
  const sticky = stickyHeader ?? rows.length > 12;
  const rule = "border-t border-[rgba(243,234,219,0.12)]";

  return (
    <Reveal>
      <table className="mt-[26px] w-full border-separate border-spacing-0 text-start max-[900px]:block">
        {/* Hidden narrow: each cell reproduces its own column label there. */}
        <thead
          className={cn(
            "max-[900px]:hidden",
            sticky && "sticky top-[86px] z-[5] bg-navy"
          )}
        >
          <tr>
            <th scope="col" className="w-[24%] pb-2.5 text-start font-normal">
              <MonoLabel size={10} className="text-muted">
                {criterionLabel}
              </MonoLabel>
            </th>
            <th scope="col" className="w-[38%] px-[18px] pb-2.5 text-start font-normal">
              <MonoLabel size={10} className="text-muted">
                {columnA}
              </MonoLabel>
            </th>
            {/* The one gold rule. */}
            <th
              scope="col"
              className="w-[38%] border-b border-gold px-[18px] pb-2.5 text-start font-normal"
            >
              <MonoLabel size={10} className="text-gold">
                {columnB}
              </MonoLabel>
            </th>
          </tr>
        </thead>
        <tbody className="max-[900px]:block">
          {rows.map((row) => (
            <tr
              key={row.dimension}
              // Written out, not interpolated: Tailwind cannot see a class built from a
              // variable, and `max-[900px]:${rule}` would also only have applied the
              // variant to the first of the two utilities.
              className="max-[900px]:grid max-[900px]:grid-cols-2 max-[900px]:border-t max-[900px]:border-[rgba(243,234,219,0.12)]"
            >
              {/* Spans both value cells narrow, as the group heading. Side by side and
                  not stacked below it: the reader is comparing two things, and stacking
                  them puts a scroll between the two halves of every comparison. */}
              <th
                scope="row"
                className={`${rule} py-4 text-start align-top font-assistant text-[14px] font-normal leading-[1.5] text-muted max-[900px]:col-span-2 max-[900px]:border-t-0 max-[900px]:pb-1.5 max-[900px]:pt-3.5 max-[900px]:text-cream`}
              >
                {row.dimension}
              </th>
              <td
                className={`${rule} px-[18px] py-4 align-top font-assistant text-[15px] font-light leading-[1.65] text-muted max-[900px]:border-t-0 max-[900px]:pb-4 max-[900px]:pe-3.5 max-[900px]:ps-0 max-[900px]:pt-1.5 max-[900px]:text-[14px]`}
              >
                <MonoLabel size={10} className="mb-1 hidden text-muted max-[900px]:block">
                  {columnA}
                </MonoLabel>
                {row.a}
              </td>
              {/* Navy glass down the full height, making a lane. Navy and not the cream
                  wash: under a cream wash gold measures 3.8:1. */}
              <td
                className={`${rule} bg-[rgba(11,27,51,0.5)] px-[18px] py-4 align-top font-assistant text-[15px] font-light leading-[1.65] text-cream max-[900px]:border-t-0 max-[900px]:pb-4 max-[900px]:pe-0 max-[900px]:ps-3.5 max-[900px]:pt-1.5 max-[900px]:text-[14px]`}
              >
                <MonoLabel size={10} className="mb-1 hidden text-gold max-[900px]:block">
                  {columnB}
                </MonoLabel>
                {row.b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Reveal>
  );
}

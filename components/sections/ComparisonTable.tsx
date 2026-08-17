import { Reveal } from "@/components/motion/Reveal";

export function ComparisonTable({
  columnA,
  columnB,
  rows,
}: {
  columnA: string;
  columnB: string;
  rows: { dimension: string; a: string; b: string }[];
}) {
  return (
    <Reveal delay={0.1}>
      {/* Desktop / tablet: a real semantic table, kept in the DOM at every
          breakpoint (only its display is toggled) so the comparison data
          stays crawlable regardless of viewport. */}
      <div className="hidden overflow-hidden rounded-2xl border border-lineDark md:block">
        <table className="w-full border-collapse text-start">
          <thead>
            <tr className="border-b border-lineDark bg-cream">
              <th className="w-[28%] p-4 text-start text-xs font-semibold uppercase tracking-[0.12em] text-navy/35">
                &nbsp;
              </th>
              <th className="p-4 text-start text-sm font-medium text-navy/60">{columnA}</th>
              <th className="p-4 text-start text-sm font-medium text-navy">{columnB}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.dimension} className="border-b border-lineDark last:border-0 even:bg-cream/40">
                <td className="p-4 text-sm font-medium text-navy/70">{row.dimension}</td>
                <td className="p-4 text-sm leading-relaxed text-navy/50">{row.a}</td>
                <td className="p-4 text-sm leading-relaxed text-navy">{row.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow viewports: the same data as stacked cards, so nothing gets
          clipped by horizontal table scroll on RTL / small screens. */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <div key={row.dimension} className="rounded-2xl border border-lineDark bg-cream/40 p-5">
            <h3 className="text-sm font-medium text-navy">{row.dimension}</h3>
            <dl className="mt-3 flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-xs text-navy/40">{columnA}</dt>
                <dd className="text-sm leading-relaxed text-navy/60">{row.a}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-xs font-medium text-navy/50">{columnB}</dt>
                <dd className="text-sm font-medium leading-relaxed text-navy">{row.b}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

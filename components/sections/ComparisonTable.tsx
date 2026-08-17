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
      <div className="overflow-x-auto rounded-2xl border border-lineDark">
        <table className="w-full min-w-[640px] border-collapse text-start">
          <thead>
            <tr className="border-b border-lineDark bg-cream">
              <th className="w-1/3 p-4 text-start text-xs font-semibold uppercase tracking-[0.12em] text-navy/35">
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
    </Reveal>
  );
}

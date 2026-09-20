import { Reveal } from "@/components/motion/Reveal";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";

// /he redesign comparison-row pattern, built to the design_handoff_ankora_redesign/
// README.md spec word for word (this went through several iterations during design):
// each row is its own block in a 1px grid; the row label is a full-width, start-aligned
// hairline-underlined header spanning BOTH columns (never centred -- centring makes it
// read as belonging to the gold column); below it, two values in an auto-fit row, each
// delineated by a border-inline-start (translucent cream for the comparison side, solid
// gold for the Ankora side). Never a fixed three-column grid -- one was tried here and
// failed badly at narrow widths (one-word-per-line).
function HeComparisonTable({
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
      <HairlineGrid minCell={9999}>
        {rows.map((row) => (
          <HairlineGridCell key={row.dimension}>
            <div className="border-b border-[rgba(243,234,219,0.16)] pb-3.5 text-start text-[14.5px] font-semibold tracking-[0.02em] text-cream">
              {row.dimension}
            </div>
            <div
              className="mt-[18px] grid gap-x-8 gap-y-4"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}
            >
              <div className="border-[rgba(243,234,219,0.18)] ps-3.5" style={{ borderInlineStartWidth: 1, borderInlineStartStyle: "solid" }}>
                <div className="text-[12.5px] font-semibold text-[#7C8EA3]">{columnA}</div>
                <div className="mt-1.5 text-[14.5px] font-light leading-relaxed text-[#A9B8C9]">{row.a}</div>
              </div>
              <div className="border-gold ps-3.5" style={{ borderInlineStartWidth: 1, borderInlineStartStyle: "solid" }}>
                <div className="text-[12.5px] font-semibold text-gold">{columnB}</div>
                <div className="mt-1.5 text-[14.5px] font-light leading-relaxed text-cream">{row.b}</div>
              </div>
            </div>
          </HairlineGridCell>
        ))}
      </HairlineGrid>
    </Reveal>
  );
}

export function ComparisonTable({
  columnA,
  columnB,
  rows,
  locale,
}: {
  columnA: string;
  columnB: string;
  rows: { dimension: string; a: string; b: string }[];
  locale?: "he" | "en";
}) {
  if (locale === "he") {
    return <HeComparisonTable columnA={columnA} columnB={columnB} rows={rows} />;
  }

  return (
    <Reveal delay={0.1}>
      {/* Desktop / tablet: a real semantic table, kept in the DOM at every
          breakpoint (only its display is toggled) so the comparison data
          stays crawlable regardless of viewport. */}
      <div className="hidden overflow-hidden rounded-2xl border border-lineDark md:block">
        <table className="w-full border-collapse text-start">
          <thead>
            <tr className="border-b border-lineDark bg-cream-warm">
              <th className="w-[28%] p-4 text-start text-xs font-semibold uppercase tracking-[0.12em] text-appNavy/35">
                &nbsp;
              </th>
              <th className="p-4 text-start text-sm font-medium text-appNavy/60">{columnA}</th>
              <th className="p-4 text-start text-sm font-medium text-appNavy">{columnB}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.dimension} className="border-b border-lineDark last:border-0 even:bg-cream-warm/40">
                <td className="p-4 text-sm font-medium text-appNavy/70">{row.dimension}</td>
                <td className="p-4 text-sm leading-relaxed text-appNavy/50">{row.a}</td>
                <td className="p-4 text-sm leading-relaxed text-appNavy">{row.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow viewports: the same data as stacked cards, so nothing gets
          clipped by horizontal table scroll on RTL / small screens. */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <div key={row.dimension} className="rounded-2xl border border-lineDark bg-cream-warm/40 p-5">
            <h3 className="text-sm font-medium text-appNavy">{row.dimension}</h3>
            <dl className="mt-3 flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-xs text-appNavy/40">{columnA}</dt>
                <dd className="text-sm leading-relaxed text-appNavy/60">{row.a}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-xs font-medium text-appNavy/50">{columnB}</dt>
                <dd className="text-sm font-medium leading-relaxed text-appNavy">{row.b}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

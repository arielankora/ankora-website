// The weekly email of the org brain's measures (spec section 11), for the
// managers who decide whether the file works. Pure: the daily job sends
// it, the tests read it.
//
// Short on purpose: the line for all clients, each measure beside its
// target, then only what is off per client. The screen holds the rest.

import { BATCH_WINDOW_DAYS, COVERAGE_WINDOW_DAYS, RUNS_WINDOW_DAYS, UNCERTAIN_STALE_DAYS, type Measure, type MetricsReport } from "@/lib/brain-metrics";
import { HEBREW, type Outgoing } from "@/lib/i18n/outgoing";

// ADR 0006, outgoing channels: in the admin's own language. Each measure
// is worded from `brainMetrics.measures.<key>`, the words the metrics
// screen uses, so the email and the screen say the same thing; the units
// and windows below match app/(product)/app/(authenticated)/brain-metrics.

const STATE_COLOR: Record<Measure["state"], string> = { ok: "#2F6B4F", off: "#9A5B13", none: "rgba(27,42,61,.45)" };

const UNIT: Record<string, "percent" | "count" | "minutes" | "days"> = {
  running: "percent",
  completeness: "percent",
  coverage: "percent",
  staleUncertain: "count",
  noAccess: "count",
  withAnkora: "percent",
  batchMinutes: "minutes",
  oldestProposal: "days",
  onTime: "percent",
};
const WINDOW_DAYS: Record<string, number> = {
  coverage: COVERAGE_WINDOW_DAYS,
  staleUncertain: UNCERTAIN_STALE_DAYS,
  batchMinutes: BATCH_WINDOW_DAYS,
  onTime: RUNS_WINDOW_DAYS,
};

/// A measure's label, target, display and state in the reader's language.
/// A key the dictionary does not know keeps the Hebrew lib/ wrote.
function words(m: Measure, out: Outgoing): { label: string; target: string; display: string; state: string } {
  const r = out.root;
  const known = m.key in UNIT;
  const days = { days: String(WINDOW_DAYS[m.key] ?? "") };
  const display = () => {
    if (m.value === null) return r("brainMetrics.display.none");
    switch (UNIT[m.key]) {
      case "percent":
        return r("brainMetrics.display.percent", { value: String(m.value) });
      case "minutes":
        return r("brainMetrics.display.minutes", { value: String(m.value) });
      case "days":
        return r("brainMetrics.display.days", { value: m.value });
      default:
        return String(m.value);
    }
  };
  return {
    label: known ? r(`brainMetrics.measures.${m.key}.label`, days) : m.label,
    target: known ? r(`brainMetrics.measures.${m.key}.target`) : m.target,
    display: known ? display() : m.display,
    state: r(`brainMetrics.states.${m.state}`),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function metricsSubject(r: MetricsReport, weekLabel: string, out: Outgoing = HEBREW): string {
  const off = r.all.filter((m) => m.state === "off").length;
  return off === 0 ? out.t("brainMetrics.subjectAllOk", { week: weekLabel }) : out.t("brainMetrics.subjectOff", { week: weekLabel, count: off });
}

export function renderMetricsEmail(r: MetricsReport, name: string, base: string, weekLabel: string, out: Outgoing = HEBREW): { html: string; text: string } {
  const { t } = out;
  const text: string[] = [t("greeting", { name }), "", t("brainMetrics.lead", { week: weekLabel }), ""];
  for (const m of r.all) {
    const w = words(m, out);
    text.push(t("brainMetrics.line", { label: w.label, display: w.display, target: w.target, state: w.state }));
  }
  const behind = r.clients
    .map((c) => ({ name: c.clientName, off: c.measures.filter((m) => m.state === "off") }))
    .filter((c) => c.off.length > 0);
  const offText = (ms: Measure[]) => ms.map((m) => `${words(m, out).label} ${words(m, out).display}`).join(", ");
  if (behind.length) {
    text.push("", t("brainMetrics.byClientText"));
    for (const c of behind) text.push(`- ${c.name}: ${offText(c.off)}`);
  }
  text.push("", `${base}/app/brain-metrics`);

  const rows = r.all
    .map((m) => {
      const w = words(m, out);
      return `<tr>
  <td style="padding:8px 0;border-bottom:1px solid rgba(27,42,61,.08);font-size:14px;color:#0B1B33;" align="${out.start}">${escapeHtml(w.label)}</td>
  <td style="padding:8px 8px;border-bottom:1px solid rgba(27,42,61,.08);font-size:14px;color:#0B1B33;white-space:nowrap;" align="${out.start}">${escapeHtml(w.display)}</td>
  <td style="padding:8px 0;border-bottom:1px solid rgba(27,42,61,.08);font-size:12.5px;color:rgba(27,42,61,.6);" align="${out.start}">${escapeHtml(t("brainMetrics.target", { target: w.target }))}<br><span style="color:${STATE_COLOR[m.state]};">${escapeHtml(w.state)}</span></td>
</tr>`;
    })
    .join("");
  const perClient = behind.length
    ? `<p style="margin:22px 0 6px;font-size:14px;font-weight:600;color:#0B1B33;" dir="${out.dir}" align="${out.start}">${escapeHtml(t("brainMetrics.byClient"))}</p>` +
      behind
        .map(
          (c) =>
            `<p style="margin:0 0 6px;font-size:13.5px;line-height:1.6;color:rgba(27,42,61,.8);" dir="${out.dir}" align="${out.start}"><strong>${escapeHtml(c.name)}:</strong> ${escapeHtml(offText(c.off))}</p>`
        )
        .join("")
    : "";
  const html = `<!doctype html>
<html dir="${out.dir}" lang="${out.locale}">
  <body style="margin:0;padding:0;background:#F8F4EC;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F4EC;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid rgba(27,42,61,.12);border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
            <tr>
              <td style="background:#1B2A3D;padding:18px 24px;">
                <span style="font-size:14px;font-weight:600;letter-spacing:.18em;color:#F3EADB;">ANKORA</span>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 24px 28px;" dir="${out.dir}" align="${out.start}">
                <p style="margin:0;font-size:19px;font-weight:500;color:#0B1B33;">${escapeHtml(t("brainMetrics.heading", { week: weekLabel }))}</p>
                <p style="margin:6px 0 16px;font-size:13.5px;color:rgba(27,42,61,.65);">${escapeHtml(t("brainMetrics.intro", { name }))}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
                ${perClient}
                <p style="margin:24px 0 0;"><a href="${escapeHtml(base)}/app/brain-metrics" style="color:#9C7A45;font-size:14px;">${escapeHtml(t("brainMetrics.link"))}</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { html, text: text.join("\n") };
}

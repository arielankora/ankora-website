// The weekly email of the org brain's measures (spec section 11), for the
// managers who decide whether the file works. Pure: the daily job sends
// it, the tests read it.
//
// Short on purpose: the line for all clients, each measure beside its
// target, then only what is off per client. The screen holds the rest.

import type { Measure, MetricsReport } from "@/lib/brain-metrics";

const STATE_TEXT: Record<Measure["state"], string> = { ok: "עומד ביעד", off: "עוד לא", none: "אין נתונים" };
const STATE_COLOR: Record<Measure["state"], string> = { ok: "#2F6B4F", off: "#9A5B13", none: "rgba(27,42,61,.45)" };

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function metricsSubject(r: MetricsReport, weekLabel: string): string {
  const off = r.all.filter((m) => m.state === "off").length;
  return off === 0 ? `מדדי התיק, שבוע ${weekLabel}: הכול ביעד` : `מדדי התיק, שבוע ${weekLabel}: ${off === 1 ? "מדד אחד" : `${off} מדדים`} עוד לא ביעד`;
}

export function renderMetricsEmail(r: MetricsReport, name: string, base: string, weekLabel: string): { html: string; text: string } {
  const text: string[] = [`שלום ${name},`, "", `מדדי התיק לשבוע ${weekLabel}, לכל הלקוחות יחד:`, ""];
  for (const m of r.all) text.push(`- ${m.label}: ${m.display} (יעד: ${m.target}). ${STATE_TEXT[m.state]}.`);
  const behind = r.clients
    .map((c) => ({ name: c.clientName, off: c.measures.filter((m) => m.state === "off") }))
    .filter((c) => c.off.length > 0);
  if (behind.length) {
    text.push("", "מה עוד לא ביעד, לפי לקוח:");
    for (const c of behind) text.push(`- ${c.name}: ${c.off.map((m) => `${m.label} ${m.display}`).join(", ")}`);
  }
  text.push("", `${base}/app/brain-metrics`);

  const rows = r.all
    .map(
      (m) => `<tr>
  <td style="padding:8px 0;border-bottom:1px solid rgba(27,42,61,.08);font-size:14px;color:#0B1B33;" align="right">${escapeHtml(m.label)}</td>
  <td style="padding:8px 8px;border-bottom:1px solid rgba(27,42,61,.08);font-size:14px;color:#0B1B33;white-space:nowrap;" align="right">${escapeHtml(m.display)}</td>
  <td style="padding:8px 0;border-bottom:1px solid rgba(27,42,61,.08);font-size:12.5px;color:rgba(27,42,61,.6);" align="right">יעד: ${escapeHtml(m.target)}<br><span style="color:${STATE_COLOR[m.state]};">${STATE_TEXT[m.state]}</span></td>
</tr>`
    )
    .join("");
  const perClient = behind.length
    ? `<p style="margin:22px 0 6px;font-size:14px;font-weight:600;color:#0B1B33;" dir="rtl" align="right">מה עוד לא ביעד, לפי לקוח</p>` +
      behind
        .map(
          (c) =>
            `<p style="margin:0 0 6px;font-size:13.5px;line-height:1.6;color:rgba(27,42,61,.8);" dir="rtl" align="right"><strong>${escapeHtml(c.name)}:</strong> ${escapeHtml(c.off.map((m) => `${m.label} ${m.display}`).join(", "))}</p>`
        )
        .join("")
    : "";
  const html = `<!doctype html>
<html dir="rtl" lang="he">
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
              <td style="padding:26px 24px 28px;" dir="rtl" align="right">
                <p style="margin:0;font-size:19px;font-weight:500;color:#0B1B33;">מדדי התיק, שבוע ${escapeHtml(weekLabel)}</p>
                <p style="margin:6px 0 16px;font-size:13.5px;color:rgba(27,42,61,.65);">שלום ${escapeHtml(name)}, כך התיק עובד השבוע, לכל הלקוחות יחד.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
                ${perClient}
                <p style="margin:24px 0 0;"><a href="${escapeHtml(base)}/app/brain-metrics" style="color:#9C7A45;font-size:14px;">למסך המדדים</a></p>
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

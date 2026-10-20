import { test, expect } from "./fixtures";

// Two screens became tabs of another on 19.10.2026 (canvas "Ankora App UI
// Round"): /app/my-time is a tab of the timer, /app/report-schedules a tab
// of the reports. Their addresses stay as redirects, for bookmarks and old
// links. (The portal's monthly report, the third, is checked from a
// client's session in ui-round.client.spec.ts, since only a client lands
// on the portal.)
//
// What can break is the query: the week or the client a link pointed at.
// The redirect runs inside a streamed page, so the first response is a 200
// and the move happens in the browser; that is why this follows it in a
// page rather than reading a status code. The landing address must carry
// exactly the keys it should, and nothing smuggled along with them.
const CASES = [
  { from: "/app/my-time?week=2026-10-12&next=https://evil.test", to: "/app/timer", expect: { tab: "mine", week: "2026-10-12" } },
  { from: "/app/my-time", to: "/app/timer", expect: { tab: "mine" } },
  { from: "/app/report-schedules?clientId=demo-client-a", to: "/app/reports", expect: { tab: "schedules", clientId: "demo-client-a" } },
  // 20.10.2026: "ממתין לאישור" is the tab "ידע מהחילוץ" of "אישורים". Its
  // filters come along, a repeated kind included, and nothing else does.
  { from: "/app/knowledge?clientId=demo-client-b&kind=FACT.NOTE&evil=1", to: "/app/approvals", expect: { tab: "knowledge", clientId: "demo-client-b", kind: "FACT.NOTE" } },
];

for (const c of CASES) {
  test(`${c.from} lands on ${c.to} with its own keys`, async ({ page }) => {
    await page.goto(c.from, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname === c.to, { timeout: 30_000 });
    const landed = new URL(page.url());
    expect(Object.fromEntries(landed.searchParams)).toEqual(c.expect);
  });
}

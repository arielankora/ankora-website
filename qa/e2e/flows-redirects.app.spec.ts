import { test, expect } from "@playwright/test";

// Three screens became tabs of another on 19.10.2026 (canvas "Ankora App UI
// Round"): /app/my-time is a tab of the timer, /app/report-schedules a tab
// of the reports, /app/portal/monthly a view of the portal's hours. Their
// addresses stay as redirects, because they are in bookmarks and, for the
// monthly report, in the emails clients receive every month.
//
// What can break is the query: the week, the client or the month a link
// pointed at. So each redirect is read as a redirect (no following), and
// its target is checked for exactly the keys it should carry and nothing
// smuggled along with them.
const CASES = [
  { from: "/app/my-time?week=2026-10-12&next=https://evil.test", to: "/app/timer", expect: { tab: "mine", week: "2026-10-12" } },
  { from: "/app/report-schedules?clientId=demo-client-a", to: "/app/reports", expect: { tab: "schedules", clientId: "demo-client-a" } },
  { from: "/app/portal/monthly?monthOffset=-1", to: "/app/portal/hours", expect: { view: "monthly", monthOffset: "-1" } },
  { from: "/app/portal/monthly", to: "/app/portal/hours", expect: { view: "monthly" } },
];

for (const c of CASES) {
  test(`${c.from} redirects to ${c.to} with its own keys`, async ({ request }) => {
    const res = await request.get(c.from, { maxRedirects: 0 });
    expect([307, 308], `${c.from} status`).toContain(res.status());
    const location = new URL(res.headers()["location"] ?? "", "http://x.test");
    expect(location.pathname).toBe(c.to);
    expect(Object.fromEntries(location.searchParams)).toEqual(c.expect);
  });
}

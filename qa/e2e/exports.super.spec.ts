import { test, expect } from "./fixtures";

// The download that never left the server.
//
// 26.9.2026, level-3 hunt. Both internal export routes built their
// Content-Disposition header by putting the client's name into
// filename="...". Every client here is named in Hebrew, a header value is
// a ByteString, and the Response constructor throws on any character
// above 255 - so the export returned 500 before a byte of the file was
// sent, in CSV, XLSX and PDF alike. Unfiltered exports were fine, which
// is why it went unnoticed: the failure needs a client filter, and the
// filter is the normal way to use the screen.
//
// @covers api:/api/reports/export
// @covers api:/api/time-entries/export
//
// Why the status and not the bytes: the fault happened while building the
// response, so every format failed identically and nothing about the file
// itself was ever in question. A test that parsed the workbook would be
// asserting something that was never broken, and would still pass if the
// header regressed on the CSV branch alone.
//
// The client id is read off the screen rather than seeded here, because
// the point is the name the product actually carries. A fixture named in
// Latin letters would pass against the broken code.

test.describe.configure({ timeout: 60_000 });

const FORMATS = ["csv", "xlsx", "pdf"] as const;

/// The filter card's client picker, found by the one option it always has
/// rather than by position. The label above it is not bound to the select,
/// and the application shell renders its own client list on every screen.
function clientFilter(page: import("@playwright/test").Page) {
  // `:text-is` and not a role query: a native select's options are not
  // reliably exposed as ARIA options until the list is open.
  return page.locator('select:has(option:text-is("כל הלקוחות"))').first();
}

async function firstClient(page: import("@playwright/test").Page) {
  const select = clientFilter(page);
  await expect(select).toBeVisible();
  const option = await select.evaluate((el: HTMLSelectElement) => {
    const found = Array.from(el.options).find((o) => o.value !== "");
    return found ? { id: found.value, name: found.textContent?.trim() ?? "" } : null;
  });
  expect(option, "no client to filter by, the seed did not run").not.toBeNull();
  return option!;
}

/// The name as it can appear in a filename: the helper strips the
/// characters that would change what the header means, and `בע"מ` in a
/// seeded client name contains one of them.
function filenameSafe(name: string) {
  return name.replace(/[\u0000-\u001f\u007f"\\/]+/g, "-").trim();
}

async function expectDownloadable(
  page: import("@playwright/test").Page,
  url: string,
  clientName: string
) {
  const res = await page.request.get(url);
  expect(res.status(), `${url} did not return a file`).toBe(200);

  // A lost session answers 200 with the login page, which would make
  // every assertion below pass against nothing.
  const type = res.headers()["content-type"] ?? "";
  expect(type, `${url} returned a page, not a download: the session is gone`).not.toContain("text/html");

  const disposition = res.headers()["content-disposition"] ?? "";
  expect(disposition, `${url} sent no filename`).toContain("filename");

  // The Hebrew name has to survive somewhere, or the fix would be "strip
  // the name until the header stops throwing" - which is what the code
  // this replaced already did, and it still threw.
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  expect(encoded, `${url} sent no RFC 5987 filename*`).toBeTruthy();
  expect(decodeURIComponent(encoded!)).toContain(filenameSafe(clientName));
}

test("the time-entry export survives a Hebrew client name, in every format", async ({ page }) => {
  await page.goto("/app/time-entries");
  const client = await firstClient(page);

  for (const format of FORMATS) {
    await expectDownloadable(
      page,
      `/api/time-entries/export?clientId=${encodeURIComponent(client.id)}&format=${format}`,
      client.name
    );
  }
});

test("the reports export survives a Hebrew client name, in every format", async ({ page }) => {
  await page.goto("/app/time-entries");
  const client = await firstClient(page);

  for (const format of FORMATS) {
    await expectDownloadable(
      page,
      `/api/reports/export?type=hours_by_client&clientId=${encodeURIComponent(client.id)}&format=${format}`,
      client.name
    );
  }
});

// The unfiltered export was never broken. It is here so that a future
// change which "fixes" the header by dropping the client name entirely
// cannot pass by making both tests above agree with it.
test("the unfiltered export still names itself", async ({ page }) => {
  const res = await page.request.get("/api/time-entries/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"] ?? "").not.toContain("text/html");
  expect(res.headers()["content-disposition"] ?? "").toContain("all-clients");
});

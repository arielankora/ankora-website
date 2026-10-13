import { test, expect } from "./fixtures";

// Org brain, phase 2 (14.10.2026): the client file to read, and its
// Markdown download. Same prose rule as flows-admin: modules are named in
// words here, never by path.
//
// @covers screen:/app/clients/[clientId]/client-file
// @covers api:/api/clients/[clientId]/client-file

const CLIENT = "demo-client-b";

test.describe("client file, to read", () => {
  test("reads in the file's order, ends with the source legend, and downloads as Markdown", async ({ page }) => {
    await page.goto(`/app/clients/${CLIENT}`);
    await page.getByRole("link", { name: "תיק הלקוח לקריאה" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${CLIENT}/client-file$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("תיק לקוח:");
    // The way into extraction: one press, a prompt in the clipboard.
    await expect(page.getByRole("button", { name: "חלץ ידע עם קלוד" })).toBeVisible();

    const headings = await page.locator("article h2").allInnerTexts();
    const at = (t: string) => headings.findIndex((h) => h.includes(t));
    expect(at("זהות הלקוח")).toBeGreaterThanOrEqual(0);
    expect(at("זהות הלקוח")).toBeLessThan(at("אנשים ויחסים"));
    expect(at("אנשים ויחסים")).toBeLessThan(at("שאלות פתוחות"));
    expect(headings[headings.length - 1]).toContain("מקרא מקורות");

    const response = await page.request.get(`/api/clients/${CLIENT}/client-file`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/markdown");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(await response.text()).toContain("## מקרא מקורות");
  });

  test("a client that does not exist is a 404, not an error", async ({ page }) => {
    const response = await page.request.get(`/api/clients/no-such-client/client-file`);
    expect(response.status()).toBe(404);
  });
});

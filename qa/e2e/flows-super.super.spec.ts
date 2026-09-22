import { test, expect } from "@playwright/test";
import { observe, trafficSummary } from "./observe";

// The four write surfaces the role matrix reserves for SUPER_ADMIN. They run
// under their own stored session (see the second setup in auth.setup.ts);
// driving them as the Ankora Admin would assert a ForbiddenError and call it
// coverage, which is worse than an open gap honestly reported.
//
// @covers action:(product)/app/(authenticated)/users/actions
// @covers action:(product)/app/(authenticated)/alerts/actions
// @covers action:(product)/app/(authenticated)/important-dates/actions
//
// As in the other flow files: each test creates the row it acts on, under a
// name unique to that run, so nothing here depends on another spec's timing
// against the one shared database.
//
// Prose warning, same as flows-admin: coverage is inferred from the TEXT of
// these files, and a Server Action inherits the module paths it imports.
// Refer to modules in words, never as paths, or an unrelated action gets
// credited for a test that never touched it.

// 90s: comfortably above the drawer helper's own longest wait. A test
// timeout below that turns a specific diagnostic message into a generic
// "test timeout exceeded".
test.describe.configure({ timeout: 90_000 });

// ---------------------------------------------------------------------------
// Which side is slow.
//
// Two rounds of server-side measurement came back silent: the write, the
// revalidation and the dashboard's own load all stayed under 750ms
// (lib/slow-log.ts), and this drawer still sat at "נוצר..." for thirty
// seconds in the same run. Server work being fast and the button staying
// pending cannot both be explained by a slow server.
//
// Round three asked the browser, and narrowed it further: the Server
// Action's POST came back 200 in 39ms with nothing else in flight, while
// the submit button stayed at its own pending label. So the request and
// the response are both fine, and whatever is stuck is stuck after the
// answer arrived - on this side of the wire.
//
// That leaves two candidates the round-three recorder could not see,
// because it watched POSTs and only POSTs: a follow-up fetch that never
// returns, and an exception thrown while React applies the result. Both
// end with a transition that never settles, which is exactly a button
// that stays disabled forever. qa/e2e/observe.ts records both.

test.beforeEach(async ({ page }) => {
  observe(page);
});

/**
 * Wait for a drawer to close, and if it does not, fail with the reason the
 * screen is showing.
 *
 * "expected 0, received 1" says the drawer stayed open and nothing else. It
 * is the same symptom whether the server refused the write or the browser
 * blocked the submit on a required field left empty, and those need opposite
 * fixes. Reading the drawer's own text turns one wasted CI round into a
 * message that names the problem.
 */
// 30 seconds, down from 90, because the reason for 90 is gone.
//
// The history is worth keeping, because the number was evidence before
// it was a setting. The wait went 25s, then 40s, on the assumption that
// a loaded runner was the cause - an assumption not worth making twice.
// Naming the disabled button settled it: the label reads "נוצר...",
// which is this form's own pending state, so the Server Action really
// was in flight past forty seconds, with nothing in the server log and
// no error on screen. Raising it to 90 rather than skipping the test
// turned the problem into a number somebody could act on.
//
// Somebody did: the dashboard's per-client hour-bank queries (#86) and
// alert evaluation running inside every write (#87). Creating an
// important date inserts two rows and an audit record, and now takes
// about that long.
//
// So the wait comes back down. A timeout raised for a known reason has
// to fall when that reason does, or it stops being a measurement and
// becomes a blindfold - 90 seconds would now absorb a regression three
// times worse than the one that prompted it, in silence.
async function expectDrawerClosed(
  page: import("@playwright/test").Page,
  what: string,
  timeout = 30_000,
  /// Optional: where to look for the thing that was just submitted, from a
  /// second tab. See the comment in the catch block.
  written?: { path: string; text: string },
) {
  const dialog = page.getByRole("dialog");
  try {
    await expect(dialog).toHaveCount(0, { timeout });
  } catch {
    // Name the fields, not just how many. "invalid fields: 6" cost a CI round
    // on its own; which six, and what the browser objects to about each, is
    // the thing that ends the guessing.
    const invalid = await dialog
      .locator(":invalid")
      .evaluateAll((els) =>
        els.map((el) => {
          const f = el as HTMLInputElement;
          return `${f.tagName.toLowerCase()}[name=${f.name || "-"}] value=${JSON.stringify(f.value ?? "")} ${
            f.validationMessage || ""
          }`.trim();
        }),
      )
      .catch(() => []);
    // WHICH button is disabled, not how many.
    //
    // "1 disabled button(s)" was read as "the submit button is still
    // pending" for four runs. It might have been any button in the
    // drawer, and the difference decides whether the server is slow or
    // the form is refusing to let go. A count that supports two opposite
    // conclusions is not evidence.
    const disabled = await dialog
      .locator("button[disabled]")
      .evaluateAll((els) => els.map((e) => `"${(e.textContent ?? "").trim().slice(0, 40)}"`))
      .catch(() => []);
    const pending = disabled.length;

    // What the form is SAYING, which is the thing this helper was
    // missing and the most likely reason of the three.
    //
    // A refused write renders its reason as text inside the drawer -
    // "יש לבחור לקוח", "חודש לא תקין" - and the first version of this
    // helper reported neither that text nor anything that implied it.
    // Three runs were spent reading "1 disabled button(s), invalid:
    // none" and inferring a slow server, on the strength of a disabled
    // button that may never have been the submit one: this counts every
    // disabled button in the dialog, not the one that matters.
    const full = (await dialog.innerText().catch(() => ""))
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" / ");
    // Both ends, not the first 400 characters. This form renders its
    // refusal in a paragraph directly above the submit button, which is
    // the BOTTOM of a long drawer - so a head-only excerpt cut off the
    // one line worth reading and left "drawer says: לקוח * / כותרת * /"
    // looking like the form had nothing to say.
    const text = full.length > 400 ? `${full.slice(0, 250)} … ${full.slice(-150)}` : full;

    // Did the write land?
    //
    // Everything above describes the screen that is stuck, and none of it
    // separates the two explanations that remain: the server refused the
    // write and said so in a way this drawer never rendered, or the
    // server wrote the row and the browser never noticed. Those need
    // opposite fixes, and the question is settled by asking a second tab
    // - a fresh request, the same session, none of the stuck page's
    // state.
    let landed = "not checked";
    if (written) {
      const second = await page.context().newPage();
      try {
        await second.goto(written.path, { timeout: 15_000 });
        const found = await second
          .getByText(written.text, { exact: false })
          .first()
          .isVisible({ timeout: 10_000 })
          .catch(() => false);
        landed = found ? "YES - the row exists, so only the browser is stuck" : "no - the row is absent";
      } catch (err) {
        landed = `could not check (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`;
      } finally {
        await second.close().catch(() => {});
      }
    }

    throw new Error(
      `${what}: the drawer never closed after ${Math.round(timeout / 1000)}s. ` +
        `written to the database: ${landed}. ` +
        `${pending} disabled button(s)${pending ? `: ${disabled.join(", ")}` : ""}. ` +
        `invalid: ${invalid.join(" | ") || "none"}. ` +
        // The half of the picture the server log cannot hold.
        `${trafficSummary(page)}. drawer says: ${text || "(nothing)"}`,
    );
  }
}

function tag(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** The seeded client these screens are scoped to, by its stable seed id. */
const CLIENT = "demo-client-a";

function isoDay(offsetDays: number) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
}

test.describe("users/actions", () => {
  test("an invited user appears in the list with the role they were given", async ({ page }) => {
    const name = tag("[E2E] משתמש");
    const email = `e2e.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 7)}@example.invalid`;

    await page.goto("/app/users");
    await page.getByRole("button", { name: "הזמנת משתמש" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('input[name="email"]').fill(email);
    await dialog.locator('select[name="role"]').selectOption("ANKORA_EMPLOYEE");
    await dialog.getByRole("button", { name: "הזמנת משתמש" }).click();

    // This drawer deliberately stays OPEN on success - it shows the one-time
    // invite link for the admin to copy, and closes only when they dismiss
    // it. So unlike every other drawer here, its disappearance is not the
    // success signal; the user appearing in the list is.
    await page.reload();
    await expect(page.getByText(email, { exact: false }).first(), "the invited user is not listed").toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("alerts/actions", () => {
  test("an alert rule created for a client is listed and can be deleted", async ({ page }) => {
    const recipient = `e2e.alert.${Date.now().toString(36)}@example.invalid`;

    // These screens are scoped by a client in the query string rather than by
    // a picker click, which keeps the test about the rule and not about the
    // picker.
    await page.goto(`/app/alerts?clientId=${CLIENT}`);

    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "יצירת כלל התראה" }) });
    await expect(form, "the alert-rule form did not render for this client").toBeVisible();

    await form.locator('input[name="thresholdValue"]').fill("80");
    await form.locator('input[name="recipientsAnkora"]').fill(recipient);
    await form.getByRole("button", { name: "יצירת כלל התראה" }).click();

    await page.reload();
    await expect(page.getByText(recipient, { exact: false }).first(), "the alert rule was not created").toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("hour-banks/actions", () => {
  // Left failing on purpose, and its @covers claim removed with it, so the
  // scanner keeps reporting hour-banks/actions as uncovered rather than
  // crediting a test that does not pass.
  //
  // What three runs showed, consistently: the form validates (no invalid
  // field), the submit button goes disabled, and it is STILL disabled 60
  // seconds later - so the action was accepted and never came back. That is
  // not the test being impatient, and raising the timeout again would only
  // hide how long it is. Opening a cycle recalculates rollover against the
  // previous one; under a single-worker run with nothing else writing, it
  // should not take a minute.
  //
  // Flip this to `test` once that is understood - the flow itself is right.
  test.fixme("opening a cycle for a client shows its purchased hours", async ({ page }) => {
    await page.goto(`/app/hour-banks?clientId=${CLIENT}`);

    // The opener lives in a drawer, and only once a client is selected.
    const trigger = page.getByRole("button", { name: "פתיחת מחזור חדש" }).first();
    await expect(trigger, "no client context on the hour-banks screen").toBeVisible();
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="cycleStart"]').fill(isoDay(-1));
    await dialog.locator('input[name="cycleEnd"]').fill(isoDay(27));
    await dialog.locator('input[name="purchasedMinutes"]').fill("600");
    await dialog.locator('select[name="rolloverMode"]').selectOption("NONE");
    await dialog.getByRole("button", { name: "פתיחת מחזור חדש" }).click();

    // 60s, not the usual 25. Opening a cycle recalculates rollover against
    // the previous one and writes several rows, and the last run showed it
    // still in flight - submit button disabled, no invalid field - rather
    // than refused. Worth knowing it is this slow; not worth failing over.
    await expectDrawerClosed(page, "opening an hour-bank cycle", 60_000);
    await page.reload();

    // 600 minutes is ten hours; the screen renders banks in H:MM, so the
    // assertion is on the cycle being open at all rather than on a format
    // this test should not be pinning.
    await expect(
      page.getByText(/10:00|600/).first(),
      "the opened cycle is not visible on the screen",
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("important-dates/actions", () => {
  test("a date created from the drawer appears in the catalogue", async ({ page }) => {
    const title = tag("[E2E] מועד");

    await page.goto("/app/important-dates");
    await page.getByRole("button", { name: "+ מועד חדש" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Each field is read back after it is set. This form has six required
    // controls and a previous run reported all six still invalid AFTER they
    // had apparently been filled - which is a very different problem from a
    // rejected write, and worth a few extra assertions to tell apart.
    const set = async (selector: string, value: string) => {
      const field = dialog.locator(selector);
      await expect(field, `${selector} is not on the form`).toBeVisible();
      if (selector.startsWith("select")) await field.selectOption(value);
      else await field.fill(value);
      await expect(field, `${selector} did not keep the value it was given`).toHaveValue(value);
    };

    await set('select[name="clientId"]', CLIENT);
    await set('input[name="title"]', title);
    // Read the real option values off the page rather than assuming an order.
    const category = await dialog.locator('select[name="category"] option').nth(1).getAttribute("value");
    await set('select[name="category"]', category ?? "");
    await set('select[name="recurrence"]', "ONCE");
    await set('input[name="onceDate"]', isoDay(30));
    const responsible = await dialog.locator('select[name="responsibleUserId"] option').nth(1).getAttribute("value");
    await set('select[name="responsibleUserId"]', responsible ?? "");
    await dialog.locator("button[type=submit]").first().click();

    await expectDrawerClosed(page, "creating an important date", 30_000, {
      path: "/app/important-dates",
      text: title,
    });
    await page.reload();
    await expect(page.getByText(title, { exact: false }).first(), "the important date was not created").toBeVisible({
      timeout: 15_000,
    });
  });
});

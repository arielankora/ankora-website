import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PORTAL_COOKIE_OPTIONS } from "@/lib/app-domain/client-portal";

// Where the portal cookies are readable from.
//
// They carry one fact - which client this person is looking at - and they
// were scoped to "/app". The portal's exports and its document downloads
// are served from /api/portal/*, which never received them: a staff
// preview could not download anything at all, and a portal user who
// belongs to more than one client silently got their first client's files
// rather than the selected one. The screens were right and the files were
// not, which is the kind of wrong that goes unreported.
//
// This asserts the scope itself, and that the actions still clear the old
// "/app" pair - a browser holding both sends both, more specific first,
// and the stale one wins on exactly the screens that matter. The
// selection cookie lives 180 days, so waiting it out is not a plan.

const ACTIONS = "app/(product)/app/(authenticated)/portal/actions.ts";

describe("portal cookie scope", () => {
  it("is readable everywhere the product serves this person", () => {
    expect(PORTAL_COOKIE_OPTIONS.path).toBe("/");
    expect(PORTAL_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(PORTAL_COOKIE_OPTIONS.sameSite).toBe("lax");
  });

  it("clears the legacy /app pair wherever it writes or exits", () => {
    const source = readFileSync(ACTIONS, "utf8");

    // One helper, called from all three places that touch the cookies.
    expect(source).toContain('path: "/app"');
    expect(source.match(/clearLegacyPortalCookies\(jar\)/g) ?? []).toHaveLength(3);
  });
});

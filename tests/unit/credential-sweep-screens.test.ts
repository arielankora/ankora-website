import { describe, it, expect } from "vitest";
import { DYNAMIC_SCREENS, DYNAMIC_SWEEP, DYNAMIC_NOT_SWEPT, routePattern, parentListRoute, substituteKnownIds } from "../../qa/e2e/routes";

// Does the served-document sweep still cover every screen, and not just
// every column?
//
// tests/unit/credential-sweep-schema.test.ts asks the first half of this
// question: it reads prisma/schema.prisma and insists that each column
// whose name says "credential" is either matched by CREDENTIAL_PATTERNS
// or written down as reviewed. That half has been derived from the
// source of truth since 20.10.
//
// The other half was never derived from anything. APP_SCREENS drops every
// route with a dynamic segment - correctly, a blind sweep cannot invent an
// id - and nothing then asked what happened to the screens it dropped.
// The answer, on 25.10.2026, was eleven screens, of which one was covered
// by a hand-written test. The five newest had landed in the previous five
// weeks and were in no sweep at all.
//
// A perfect pattern list that runs on the wrong screens finds nothing. So
// this test does for screens what the schema test does for columns: a new
// dynamic screen is a failing test until a person decides whether the
// sweep reaches it, or writes down why it does not.

describe("the served-document sweep against the manifest", () => {
  it("finds the dynamic screens at all", () => {
    // If the extraction breaks, every assertion below passes vacuously.
    expect(DYNAMIC_SCREENS.length).toBeGreaterThanOrEqual(8);
    expect(DYNAMIC_SCREENS).toEqual(expect.arrayContaining(["/app/users/[userId]", "/app/important-dates/[id]"]));
  });

  it("sweeps every dynamic screen, or says why not", () => {
    const planned = new Set(DYNAMIC_SWEEP.map((s) => s.route));
    const unaccounted = DYNAMIC_SCREENS.filter((r) => !planned.has(r) && !(r in DYNAMIC_NOT_SWEPT));
    expect(
      unaccounted,
      [
        "These screens are in the manifest with an id in the route, and nothing sweeps them.",
        "A screen built around one record is where a database row reaches a client component,",
        "which is the fault CREDENTIAL_PATTERNS exists to catch - and it only catches it on",
        "screens something actually opens.",
        "",
        "Add the route to DYNAMIC_SWEEP in qa/e2e/routes.ts, or to DYNAMIC_NOT_SWEPT with the reason.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("plans nothing that is not a screen, and excuses nothing twice", () => {
    const known = new Set(DYNAMIC_SCREENS);
    for (const { route } of DYNAMIC_SWEEP) expect(known.has(route), `${route} is not a screen in the manifest`).toBe(true);
    for (const route of Object.keys(DYNAMIC_NOT_SWEPT)) expect(known.has(route), `${route} is not a screen in the manifest`).toBe(true);
    for (const { route } of DYNAMIC_SWEEP) expect(route in DYNAMIC_NOT_SWEPT, `${route} is both swept and excused`).toBe(false);
  });

  it("gives a reason for every screen it leaves out", () => {
    for (const [route, reason] of Object.entries(DYNAMIC_NOT_SWEPT)) {
      expect(reason.length, `${route} is excused without a reason`).toBeGreaterThan(30);
    }
    for (const { route, optional } of DYNAMIC_SWEEP) {
      if (optional !== undefined) expect(optional.length, `${route} is optional without a reason`).toBeGreaterThan(30);
    }
  });

  it("resolves a route to a matcher that accepts a real address and refuses a neighbour", () => {
    const p = routePattern("/app/clients/[clientId]/processes/[processId]/document");
    expect(p.test("/app/clients/abc123/processes/def456/document")).toBe(true);
    // A deeper or shallower address is a different screen.
    expect(p.test("/app/clients/abc123/processes/def456/document/edit")).toBe(false);
    expect(p.test("/app/clients/abc123/document")).toBe(false);

    const c = routePattern("/app/clients/[clientId]");
    expect(c.test("/app/clients/abc123")).toBe(true);
    // The sub-screens below it must not be mistaken for the client screen.
    expect(c.test("/app/clients/abc123/handover")).toBe(false);
  });

  it("names the list screen above each dynamic one", () => {
    expect(parentListRoute("/app/clients/[clientId]")).toBe("/app/clients");
    expect(parentListRoute("/app/clients/[clientId]/handover")).toBe("/app/clients");
    expect(parentListRoute("/app/important-dates/[id]")).toBe("/app/important-dates");
  });
});

describe("resolving a detail screen from the one above it", () => {
  // The sweep's one piece of logic worth testing without a browser: it
  // decides which address to open, and an address it gets wrong reads in
  // the report exactly like a screen that broke.
  const clients = new Map([["/app/clients/[clientId]", "/app/clients/cl_abc"]]);

  it("carries the id down to a sub-screen of the same record", () => {
    expect(substituteKnownIds("/app/clients/[clientId]/handover", clients)).toBe("/app/clients/cl_abc/handover");
    expect(substituteKnownIds("/app/clients/[clientId]/client-file", clients)).toBe("/app/clients/cl_abc/client-file");
  });

  it("leaves a segment nothing has resolved in brackets", () => {
    const two = substituteKnownIds("/app/clients/[clientId]/processes/[processId]/document", clients);
    expect(two).toBe("/app/clients/cl_abc/processes/[processId]/document");
    // Which is the signal the sweep uses to go looking for a link.
    expect(two.includes("/[")).toBe(true);
  });

  it("does not borrow an id from an unrelated screen", () => {
    const others = new Map([["/app/users/[userId]", "/app/users/u_1"]]);
    expect(substituteKnownIds("/app/clients/[clientId]", others)).toBe("/app/clients/[clientId]");
    expect(substituteKnownIds("/app/categories/[categoryId]", clients)).toBe("/app/categories/[categoryId]");
  });

  it("matches a route that is partly resolved", () => {
    const partial = substituteKnownIds("/app/clients/[clientId]/processes/[processId]/document", clients);
    const p = routePattern(partial);
    expect(p.test("/app/clients/cl_abc/processes/p_9/document")).toBe(true);
    // Another client's procedure is not this screen's instance.
    expect(p.test("/app/clients/cl_zzz/processes/p_9/document")).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// A plain stub rather than vi.fn: with vi.fn, the rejecting call in the
// database-down case surfaced as the test's own failure here, even though
// the route catches it.
let calls = 0;
let answer: () => Promise<unknown> = async () => [];
const { db } = vi.hoisted(() => ({ db: { $queryRaw: (..._a: unknown[]) => Promise.resolve() as Promise<unknown> } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { GET } from "@/app/api/health/route";

const req = (q = "") => new Request(`https://www.ankora.co.il/api/health${q}`);

describe("/api/health", () => {
  beforeEach(() => {
    calls = 0;
    answer = async () => [];
    db.$queryRaw = () => {
      calls++;
      return answer();
    };
  });

  // The reason this file exists: a once-a-minute monitor on a route that
  // queried the database kept Neon's compute awake around the clock and
  // spent the month's whole allowance in ten days.
  it("does not touch the database by default", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: "not-checked" });
    expect(calls).toBe(0);
  });

  it("ignores any value of db other than 1", async () => {
    await GET(req("?db=true"));
    await GET(req("?db=0"));
    expect(calls).toBe(0);
  });

  it("checks the database when asked with ?db=1", async () => {
    answer = async () => [{ "?column?": 1 }];
    const res = await GET(req("?db=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: "up" });
    expect(calls).toBe(1);
  });

  it("answers 503 with no detail when the database is unreachable", async () => {
    answer = () => Promise.reject(new Error("Can't reach database server at secret-host:5432"));
    const res = await GET(req("?db=1"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, db: "down" });
    expect(JSON.stringify(body)).not.toContain("secret-host");
  });
});

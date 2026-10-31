import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { entryPoints, inventory, judge, GUARDS, PUBLIC } from "../../qa/checks/rbac.mjs";
import { can } from "@/lib/app-auth/permissions";
import type { Permission } from "@/lib/app-auth/permissions";

// qa/checks/rbac.mjs is plain JavaScript, so what it returns arrives as `any`.
// `next build` type-checks this directory; see the note in qa-shards.test.ts.
type Row = { id: string; name: string; guards: string[] };
const rowsOf = (source: string, route = false): { name: string; guards: string[] }[] => entryPoints(source, { route });

describe("what counts as an entry point", () => {
  it("takes every exported function of a use-server file and nothing else", () => {
    const rows = rowsOf(`"use server";
      export async function a() { await requireUser(); }
      async function notExported() {}
      export const b = async () => { await requireUser(); };`);
    expect(rows.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("ignores a file that is neither a route nor a use-server file", () => {
    expect(rowsOf(`export async function a() {}`)).toEqual([]);
  });

  it("takes only the HTTP verbs of a route, and follows `export { x as GET }`", () => {
    const rows = rowsOf(
      `export const dynamic = "force-dynamic";
       export function helper() {}
       async function upload() { await requireUser(); }
       export { upload as PUT, upload as POST };
       export async function GET() {}`,
      true,
    );
    expect(rows.map((r) => r.name).sort()).toEqual(["GET", "POST", "PUT"]);
    expect(rows.find((r) => r.name === "PUT")?.guards).toEqual(["requireUser"]);
    expect(rows.find((r) => r.name === "GET")?.guards).toEqual([]);
  });
});

describe("what counts as guarded", () => {
  // The regression that made the first draft a regex-free check: the `{` of a
  // return type is not the start of the body, and a body found from there
  // misses the requireUser on its first line.
  it("finds the guard in a function whose return type has braces", () => {
    const [row] = rowsOf(`"use server";
      export async function a(x: string): Promise<{ ok: boolean; error?: string }> {
        const user = await requireUser();
        return { ok: true };
      }`);
    expect(row.guards).toEqual(["requireUser"]);
  });

  it("counts a guard called as a method or after await", () => {
    expect(rowsOf(`"use server"; export async function a() { await auth.requireUser(); }`)[0].guards).toEqual(["requireUser"]);
  });

  it("does not count a guard that is only mentioned", () => {
    const [row] = rowsOf(`"use server";
      // requireUser would go here
      export async function a() { const s = "requireUser("; return s; }`);
    expect(row.guards).toEqual([]);
  });

  it("does not count a guard in a different function of the same file", () => {
    const rows = rowsOf(`"use server";
      export async function guarded() { await requireUser(); }
      export async function open() { return 1; }`);
    expect(rows.find((r) => r.name === "open")?.guards).toEqual([]);
  });

  it("credits a route file that wraps its handler with withMcpAuth, and only that file", () => {
    const wrapped = rowsOf(
      `const authed = withMcpAuth(handler, verify, { required: true });
       export async function GET(req: Request) { return authed(req); }`,
      true,
    );
    expect(wrapped[0].guards).toEqual(["withMcpAuth"]);
    expect(rowsOf(`export async function GET(req: Request) { return handler(req); }`, true)[0].guards).toEqual([]);
  });
});

describe("the verdict", () => {
  const rows: Row[] = [
    { id: "a.ts#guarded", name: "guarded", guards: ["requireUser"] },
    { id: "a.ts#open", name: "open", guards: [] },
    { id: "a.ts#listed", name: "listed", guards: [] },
  ];

  it("blocks an unguarded entry point nobody gave a reason for", () => {
    expect(judge(rows, { "a.ts#listed": "reason" }).unlisted.map((r: Row) => r.id)).toEqual(["a.ts#open"]);
  });

  it("calls a reason stale when its entry point is gone or has since been guarded", () => {
    const { stale } = judge(rows, { "a.ts#listed": "r", "a.ts#guarded": "r", "gone.ts#x": "r" });
    expect(stale.sort()).toEqual(["a.ts#guarded", "gone.ts#x"]);
  });
});

describe("this repository", () => {
  it("has no door without a lock or a reason", async () => {
    const { unlisted, stale } = judge(await inventory());
    expect(unlisted.map((r: Row) => r.id)).toEqual([]);
    expect(stale).toEqual([]);
  });

  it("gives every public entry point a reason that says something", () => {
    for (const [id, reason] of Object.entries(PUBLIC) as [string, string][]) {
      expect(reason.length, id).toBeGreaterThan(20);
    }
  });

  it("only counts guards that exist as names the code actually calls", () => {
    // A name in GUARDS that nothing calls is a guard that was renamed away,
    // and every entry point that relied on it is silently unguarded again.
    const sources = ["app", "lib"].flatMap((d) => walkSources(d)).join("\n");
    for (const name of GUARDS as string[]) {
      expect(sources, name).toMatch(new RegExp(`\\b${name}\\s*\\(`));
    }
  });
});

function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".next") out.push(...walkSources(p));
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(fs.readFileSync(p, "utf8"));
  }
  return out;
}

// The matrix itself: which role holds which permission, pinned. A change to
// ROLE_PERMISSIONS is a change to who may do what, and it should show up in a
// diff a reviewer reads rather than inside a one-line edit to a list.
describe("the role and permission table", () => {
  const src = fs.readFileSync("lib/app-auth/permissions.ts", "utf8");
  const block = src.slice(src.indexOf("export type Permission"), src.indexOf("const CREDENTIAL_PERMISSIONS"));
  const all = [...block.matchAll(/\|\s*"([a-z_.]+)"/g)].map((m) => m[1]) as Permission[];

  const held = (role: "SUPER_ADMIN" | "ANKORA_ADMIN" | "ANKORA_EMPLOYEE" | "CLIENT_USER") => all.filter((p) => can(role, p));

  it("finds the permissions it is about to pin", () => {
    expect(all.length).toBeGreaterThanOrEqual(16);
    expect(new Set(all).size).toBe(all.length);
  });

  it("pins what each role may do", () => {
    expect(held("CLIENT_USER")).toEqual(["report.client.view"]);
    expect(held("ANKORA_EMPLOYEE")).toEqual([
      "time_entry.create_self",
      "time_entry.edit_self",
      "credential.view",
      "credential.reveal",
      "credential.manage",
    ]);
    expect(held("ANKORA_ADMIN")).toEqual([
      "client.manage",
      "category.manage",
      "time_entry.create_self",
      "time_entry.edit_self",
      "time_entry.edit_others",
      "report.internal.view",
      "credential.view",
      "credential.reveal",
      "credential.manage",
    ]);
    expect(held("SUPER_ADMIN")).toEqual(all.filter((p) => p !== "report.client.view"));
  });

  it("gives every permission to somebody, so none is dead", () => {
    for (const p of all) {
      const holders = (["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE", "CLIENT_USER"] as const).filter((r) => can(r, p));
      expect(holders.length, p).toBeGreaterThan(0);
    }
  });

  it("keeps the client portal and the staff permissions apart", () => {
    for (const p of all) {
      if (p === "report.client.view") {
        expect(can("SUPER_ADMIN", p) || can("ANKORA_ADMIN", p) || can("ANKORA_EMPLOYEE", p), p).toBe(false);
      } else {
        expect(can("CLIENT_USER", p), p).toBe(false);
      }
    }
  });

  it("keeps user management, integrations, alerts and hour banks with the super admin alone", () => {
    for (const p of ["user.manage", "integration.manage", "alert.manage", "hour_bank.manage", "audit.view"] as Permission[]) {
      expect(can("SUPER_ADMIN", p), p).toBe(true);
      expect(can("ANKORA_ADMIN", p) || can("ANKORA_EMPLOYEE", p) || can("CLIENT_USER", p), p).toBe(false);
    }
  });
});

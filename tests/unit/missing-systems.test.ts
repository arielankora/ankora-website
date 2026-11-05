import { describe, expect, it } from "vitest";
import { missingSystems } from "@/lib/knowledge-proposals";

// 5.11.2026: a process named Claude, Unipile and Apollo, none of them in
// Ankora's system map, and entered without the links. The reply now names
// them while Claude can still send them as SYSTEM items.

const MAP = [
  { id: "s1", name: "Claude, חשבון התפעול" },
  { id: "s2", name: "Gusto" },
  { id: "s3", name: "Meet Alfred" },
];

const proc = (index: number, payload: Record<string, unknown>) => ({ index, target: "PROCESS", action: "CREATE", payload });

describe("missingSystems", () => {
  it("names a process's systems that are neither in the map nor in the batch, from the process and its steps", () => {
    const r = missingSystems([proc(2, { title: "x", systemNames: ["Gusto", "Apollo"], steps: [{ title: "a", systemNames: ["Unipile"] }] })], MAP);
    expect(r).toEqual([
      { index: 2, name: "Apollo", similar: [] },
      { index: 2, name: "Unipile", similar: [] },
    ]);
  });

  it("matches the map as the link does on approval: case and spaces aside, the whole name", () => {
    expect(missingSystems([proc(0, { title: "x", systemNames: ["  gusto ", "MEET  ALFRED"] })], MAP)).toEqual([]);
  });

  it("does not ask for a system proposed as SYSTEM in the same batch", () => {
    const items = [proc(0, { title: "x", systemNames: ["Apollo"] }), { index: 1, target: "SYSTEM", action: "CREATE", payload: { systemName: "apollo" } }];
    expect(missingSystems(items, MAP)).toEqual([]);
  });

  it("offers a look-alike from the map, so the name in the file is used rather than a second system", () => {
    const [r] = missingSystems([proc(0, { title: "x", systemNames: ["Claude"] })], MAP);
    expect(r).toEqual({ index: 0, name: "Claude", similar: [{ id: "s1", name: "Claude, חשבון התפעול" }] });
  });

  it("names a system once per process, however often its steps repeat it", () => {
    const r = missingSystems([proc(0, { title: "x", systemNames: ["Apollo"], steps: [{ title: "a", systemNames: ["Apollo", "apollo"] }] })], MAP);
    expect(r).toHaveLength(1);
  });

  it("looks only at processes, and ignores what is not a name", () => {
    const items = [
      { index: 0, target: "SYSTEM", action: "CREATE", payload: { systemName: "Zapier" } },
      { index: 1, target: "FACT", action: "CREATE", payload: { body: "Apollo" } },
      proc(2, { title: "x", systemNames: ["", 3, null], steps: "none" }),
    ];
    expect(missingSystems(items, MAP)).toEqual([]);
  });
});

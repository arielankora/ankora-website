import { describe, expect, it } from "vitest";
import { compileAgent } from "@/lib/agents/compile";
import type { AgentParam } from "@/lib/agents/model";

// A LIBRARY_BLOCK parameter (23.11.2026): the person running the agent
// picks a library block by key, and its approved body is what Claude reads.

const voice: AgentParam = { key: "voice", label: "קול", level: "INSTALLATION", type: "LIBRARY_BLOCK", required: true, default: "ariel-voice", clientField: null };
const library = { "ariel-voice": { title: "הקול של אריאל", body: "כותבים קצר, עם קריצה." }, "nadav-voice": { title: "הקול של נדב", body: "דיוק לפני רושם." } };
const input = (values: Record<string, string>, lib = library) =>
  compileAgent({
    agent: { name: "Posts", slug: "posts", purpose: "פוסטים" },
    version: { version: 1, actionLevel: "DRAFT", blocks: [{ key: "lang", kind: "language", title: "קול", body: "{{voice}}" }], params: [voice], requirements: { connectors: [], skills: [], repos: [], localMcp: [], externalRunners: [] } },
    installation: { id: "inst1", values, userName: "Ariel" },
    clients: [],
    library: lib,
  });

describe("a library block chosen by parameter", () => {
  it("puts the default block's body in place", () => {
    expect(input({}).text).toContain("כותבים קצר, עם קריצה.");
  });

  it("follows the installation's choice", () => {
    const text = input({ voice: "nadav-voice" }).text;
    expect(text).toContain("דיוק לפני רושם.");
    expect(text).not.toContain("כותבים קצר");
  });

  it("says so when the block is missing or not approved", () => {
    expect(input({ voice: "nobody-voice" }).text).toContain('קטע הספרייה "nobody-voice" לא נמצא');
  });
});

import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestUser } from "./factories";
import { AI_EXCLUDED_TOOL_MESSAGE } from "@/lib/ai-exclusion";

// New-client wizard (26.11.2026): a setup continued from Claude, through
// the connector. What is worth holding: the AI decision is Claude's to
// pass on, never to assume; every item cites a source; a refusal reaches
// Claude in the domain's words and the rest is saved; contact details are
// not sent back; nothing activates the client; a client marked "בלי AI"
// is out of reach; and the other tools still do not see a setup.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);

async function call(user: User, name: string, args: unknown) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text, isError: result.isError };
  } catch {
    return { json: null, text, isError: result.isError };
  }
}

async function setup() {
  const { user: a } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: h } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const ariel = await prisma.user.update({ where: { id: a.id }, data: { name: "אריאל" } });
  const hadas = await prisma.user.update({ where: { id: h.id }, data: { name: "הדס" } });
  return { ariel, hadas };
}

describe("setting up a client from Claude", () => {
  it("opens a setup, fills it from an email, and says what is still missing", async () => {
    const { ariel } = await setup();
    const started = await call(ariel, "start_client_onboarding", { name: "חברת דוגמה", kind: "BUSINESS", aiExcluded: false });
    expect(started.json.created).toBe(true);
    expect(started.json.step).toBe(1);
    expect(started.json.url).toContain("/setup");
    expect(started.json.fieldNotes.missing).toBeTruthy();

    const filled = await call(ariel, "update_client_onboarding", {
      client: "חברת דוגמה",
      source: { newSource: { kind: "EMAIL", title: "מייל מדנה, 20.11", occurredAt: "2026-11-20" } },
      domains: ["example-mcp.co.il", "gmail.com"],
      partners: [{ name: "משרד רו\"ח לדוגמה", domain: "cpa-mcp.co.il", role: "רואה חשבון" }],
      contacts: [
        { name: "דנה כהן", role: "תפעול", email: "dana@example-mcp.co.il", isPrimary: true },
        { name: "יואב", role: "כספים" },
      ],
      preferredChannel: "WHATSAPP",
      accountManager: "אריאל",
      backupManager: "הדס",
    });

    expect(filled.json.domains).toEqual(["example-mcp.co.il"]);
    // The public domain is refused in the domain's own words, the rest saved.
    expect(filled.json.errors).toEqual([{ item: "domain gmail.com", error: expect.stringContaining("שירות מייל ציבורי") }]);
    expect(filled.json.partners).toEqual([{ name: "משרד רו\"ח לדוגמה", domains: ["cpa-mcp.co.il"], role: "רואה חשבון", source: "מייל מדנה, 20.11" }]);
    // No addresses go back to Claude, only whether there is one.
    expect(filled.json.contacts.map((c: { name: string; hasEmail: boolean; hasPhone: boolean; source: string }) => [c.name, c.hasEmail, c.hasPhone, c.source])).toEqual([
      ["דנה כהן", true, false, "מייל מדנה, 20.11"],
      ["יואב", false, false, "מייל מדנה, 20.11"],
    ]);
    expect(filled.text).not.toContain("dana@example-mcp.co.il");
    expect(filled.json.accountManager).toBe("אריאל");
    expect(filled.json.backupManager).toBe("הדס");
    expect(filled.json.missing.map((m: { text: string }) => m.text)).toEqual([
      expect.stringContaining("יואב"),
      expect.stringContaining("כללי טיפול במידע"),
    ]);
    expect(filled.json.ready).toBe(false);

    const done = await call(ariel, "update_client_onboarding", { client: "חברת דוגמה", contacts: [], noSpecialRules: true });
    expect(done.json.missing.length).toBe(1);

    const list = await call(ariel, "get_client_onboarding", {});
    expect(list.json.setups.map((s: { client: string }) => s.client)).toEqual(["חברת דוגמה"]);

    // Nothing here activates it, and the other tools still do not see it.
    expect((await prisma.client.findFirstOrThrow({ where: { name: "חברת דוגמה" } })).status).toBe("ONBOARDING");
    const mine = await call(ariel, "list_my_clients", {});
    expect(mine.text).not.toContain("חברת דוגמה");
  });

  it("refuses a setup without the AI decision", async () => {
    const { ariel } = await setup();
    const r = await call(ariel, "start_client_onboarding", { name: "x", kind: "BUSINESS" });
    expect(r.text).toContain("בינה מלאכותית");
    expect(await prisma.client.count()).toBe(0);
  });

  it("keeps a client marked 'בלי AI' out of reach once it is opened", async () => {
    const { ariel } = await setup();
    const started = await call(ariel, "start_client_onboarding", { name: "פרטי מוחרג", kind: "PRIVATE", aiExcluded: true });
    expect(started.json.note).toBe(AI_EXCLUDED_TOOL_MESSAGE);
    expect(started.json.contacts).toBeUndefined();
    expect((await call(ariel, "get_client_onboarding", { client: "פרטי מוחרג" })).text).toBe(AI_EXCLUDED_TOOL_MESSAGE);
    expect((await call(ariel, "update_client_onboarding", { client: "פרטי מוחרג", domains: ["x-mcp.co.il"] })).text).toBe(AI_EXCLUDED_TOOL_MESSAGE);
    expect((await call(ariel, "get_client_onboarding", {})).json.setups).toEqual([]);
  });

  it("is for managers only", async () => {
    const { hadas } = await setup();
    const r = await call(hadas, "start_client_onboarding", { name: "x", kind: "BUSINESS", aiExcluded: false });
    expect(r.isError).toBe(true);
    expect(await prisma.client.count()).toBe(0);
  });

  it("does not reach an active client", async () => {
    const { ariel } = await setup();
    await prisma.client.create({ data: { name: "פעיל" } });
    const r = await call(ariel, "update_client_onboarding", { client: "פעיל", domains: ["active-mcp.co.il"] });
    expect(r.text).toContain("client being set up");
    expect(await prisma.clientDomain.count()).toBe(0);
  });
});

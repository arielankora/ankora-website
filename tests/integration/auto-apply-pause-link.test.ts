import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { appBaseUrl } from "@/lib/email-templates";
import { pauseUrl } from "@/lib/approval-links";
import { parseApprovalsParams } from "@/lib/approvals";
import { autoApplyOverview, seesActivePause } from "@/lib/app-domain/auto-apply";

// A direct link to one pause on "נכנס אוטומטית" (17.11.2026). Claude
// gets it from list_approvals (`autoApplyPauses`), through the tool as a
// client calls it: a client's pause opens the knowledge review on that
// client, a kind's on every client. A client marked "בלי AI" is not
// named to Claude. And the tab with the lift button stays in reach of a
// manager while a pause is active, though nothing on it waits.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));
import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[] }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);

async function call(user: User, name: string, args: Record<string, unknown> = {}) {
  const text = (await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } })).content.map((c) => c.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

type PauseOut = { pauseId: string; scope: string; label: string; since: string; reason: string; errors?: string; url: string };

async function setup() {
  const nux = await createTestClient({ name: "NUX" });
  const secret = await prisma.client.update({ where: { id: (await createTestClient({ name: "SECRET" })).id }, data: { aiExcluded: true } });
  const { user: manager } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: employee.id, clientId: nux.id } });
  const clientPause = await prisma.autoApplyPause.create({ data: { scope: "CLIENT", key: nux.id, errors: 2, reason: "2 פריטים שנכנסו אוטומטית בוטלו או תוקנו בתוך 14 יום" } });
  const kindPause = await prisma.autoApplyPause.create({ data: { scope: "KIND", key: "CONTACT", errors: 3, reason: "3 מתוך 30 הפריטים האחרונים מסוג איש קשר שנכנסו אוטומטית בוטלו או תוקנו" } });
  const secretPause = await prisma.autoApplyPause.create({ data: { scope: "CLIENT", key: secret.id, errors: 2, reason: "2 פריטים" } });
  return { nux, secret, manager, employee, clientPause, kindPause, secretPause };
}

describe("list_approvals: autoApplyPauses, each with its link (17.11.2026)", () => {
  it("gives a manager every pause Claude may see, with a link to its row on the knowledge review", async () => {
    const { nux, manager, clientPause, kindPause, secretPause } = await setup();
    const out = await call(manager, "list_approvals");
    const pauses: PauseOut[] = out.autoApplyPauses;
    expect(pauses.map((p) => p.pauseId).sort()).toEqual([clientPause.id, kindPause.id].sort());

    const client = pauses.find((p) => p.pauseId === clientPause.id)!;
    expect(client).toMatchObject({ scope: "CLIENT", label: "NUX", url: pauseUrl(appBaseUrl(), { id: clientPause.id, clientId: nux.id }) });
    const u = new URL(client.url);
    expect(parseApprovalsParams(Object.fromEntries(u.searchParams))).toEqual({ tab: "knowledge", clientId: nux.id });
    expect(u.hash).toBe(`#pause-${clientPause.id}`);

    const kind = pauses.find((p) => p.pauseId === kindPause.id)!;
    expect(kind.scope).toBe("KIND");
    expect(kind.url).toBe(pauseUrl(appBaseUrl(), { id: kindPause.id, clientId: null }));
    expect(new URL(kind.url).searchParams.has("clientId")).toBe(false);

    // A client marked "בלי AI": not its pause, not its name, not its id.
    const text = JSON.stringify(out);
    expect(text).not.toContain(secretPause.id);
    expect(text).not.toContain("SECRET");

    // The screen itself still shows the manager all three, each row with
    // the id the link points at.
    const screen = (await autoApplyOverview(manager))!;
    expect(screen.pauses.map((p) => p.id)).toContain(secretPause.id);
    expect(screen.pauses.find((p) => p.id === clientPause.id)).toMatchObject({ clientId: nux.id, clientName: "NUX" });
    expect(screen.pauses.find((p) => p.id === kindPause.id)).toMatchObject({ clientId: null });
  });

  it("a client filter keeps that client's pause and the kinds', and kind other than knowledge leaves them out", async () => {
    const { manager, clientPause, kindPause } = await setup();
    const other = await createTestClient({ name: "RIMED" });
    await prisma.autoApplyPause.create({ data: { scope: "CLIENT", key: other.id, errors: 2, reason: "2 פריטים" } });
    const out = await call(manager, "list_approvals", { client: "NUX" });
    expect((out.autoApplyPauses as PauseOut[]).map((p) => p.pauseId).sort()).toEqual([clientPause.id, kindPause.id].sort());
    expect((await call(manager, "list_approvals", { kind: "task" })).autoApplyPauses).toBeUndefined();
  });

  it("not for someone who cannot lift a pause", async () => {
    const { employee } = await setup();
    expect((await call(employee, "list_approvals")).autoApplyPauses).toBeUndefined();
  });
});

describe("the tab with the lift button stays in reach (17.11.2026)", () => {
  it("for a manager while a pause is active; never for someone who cannot lift it", async () => {
    const { manager, employee } = await setup();
    expect(await seesActivePause(manager)).toBe(true);
    expect(await seesActivePause(employee)).toBe(false);
    await prisma.autoApplyPause.updateMany({ data: { liftedAt: new Date() } });
    expect(await seesActivePause(manager)).toBe(false);
  });
});

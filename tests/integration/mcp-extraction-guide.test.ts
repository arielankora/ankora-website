import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestUser } from "./factories";
import { approveGuide, currentGuide, listGuideVersions, proposeGuide } from "@/lib/app-domain/extraction-guide";
import { collectApprovals } from "@/lib/app-domain/approvals";
import { DEFAULT_EXTRACTION_GUIDE_LINES } from "@/lib/extract-prompt";

// propose_extraction_guide_version (14.11.2026). What is worth holding:
// Claude's version is a pending draft, listed where the screen lists
// drafts; only an admin's approval, through the screen's own function,
// puts it in use; and a refusal of the domain reaches Claude in its own
// words.

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

describe("propose_extraction_guide_version", () => {
  it("proposes a pending draft that only an admin's approval puts in use", async () => {
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
    const v1 = await proposeGuide(hadas, { body: "רק מה שהלקוח אמר\nבלי שמועות\nבלי מחירים", note: "ראשונה" });
    await approveGuide(ariel, v1.id);

    const r = await call(hadas, "propose_extraction_guide_version", { addRules: ["תאריך תמיד YYYY-MM-DD"], afterRule: 1, reason: "תאריכים אחידים" });
    expect(r.isError).toBeFalsy();
    expect(r.json).toMatchObject({
      proposed: true,
      version: 2,
      basedOnVersion: 1,
      reason: "תאריכים אחידים",
      rules: ["רק מה שהלקוח אמר", "תאריך תמיד YYYY-MM-DD", "בלי שמועות", "בלי מחירים"],
      otherDrafts: [],
    });
    expect(r.json.url).toMatch(/\/app\/extraction-guide$/);

    // Pending: on the guide screen's list and on the admin's approvals,
    // and not in use.
    const versions = await listGuideVersions(hadas);
    expect(versions.find((v) => v.id === r.json.draftId)).toMatchObject({ version: 2, state: "DRAFT", note: "תאריכים אחידים", createdById: hadas.id });
    expect((await collectApprovals(ariel)).some((row) => row.kind === "guide" && row.id === r.json.draftId)).toBe(true);
    expect((await currentGuide())?.version).toBe(1);

    // The proposer cannot approve; an admin, through the screen's function, can.
    await expect(approveGuide(hadas, r.json.draftId)).rejects.toThrow();
    await approveGuide(ariel, r.json.draftId);
    expect(await currentGuide()).toEqual({ version: 2, body: "רק מה שהלקוח אמר\nתאריך תמיד YYYY-MM-DD\nבלי שמועות\nבלי מחירים" });
  });

  it("builds on the shipped guidance when none was approved, and takes a full list", async () => {
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const added = await call(hadas, "propose_extraction_guide_version", { addRules: ["כלל חדש"], reason: "בדיקה" });
    expect(added.json.rules).toEqual([...DEFAULT_EXTRACTION_GUIDE_LINES, "כלל חדש"]);
    expect(added.json.basedOnVersion).toBeNull();

    const full = await call(hadas, "propose_extraction_guide_version", { rules: ["רק מה שנאמר במפורש"], reason: "קיצור" });
    expect(full.json).toMatchObject({ version: added.json.version + 1, rules: ["רק מה שנאמר במפורש"], otherDrafts: [{ version: added.json.version, reason: "בדיקה" }] });
  });

  it("returns the domain's refusal in its own words, and proposes nothing", async () => {
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const secret = await call(hadas, "propose_extraction_guide_version", { addRules: ["password: hunter22 לדוגמה"], reason: "דוגמה" });
    expect(secret.isError).toBe(true);
    expect(secret.text).toContain("בהנחיות יש סיסמה, מפתח או מספר כרטיס.");
    expect(secret.text).toContain("extractionGuide.hasSecret");
    expect(secret.text).not.toContain("unexpected");

    const empty = await call(hadas, "propose_extraction_guide_version", { rules: [" ", "-"], reason: "ריק" });
    expect(empty.text).toContain("ההנחיות ריקות.");

    const same = await call(hadas, "propose_extraction_guide_version", { rules: DEFAULT_EXTRACTION_GUIDE_LINES, reason: "אותו דבר" });
    expect(same.text).toContain("Nothing was proposed");

    const place = await call(hadas, "propose_extraction_guide_version", { addRules: ["x"], afterRule: 999, reason: "מקום" });
    expect(place.text).toContain("Nothing was proposed");
    expect(await prisma.extractionGuide.count()).toBe(0);
  });
});

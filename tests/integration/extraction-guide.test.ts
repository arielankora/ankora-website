import { describe, expect, it } from "vitest";
import { createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { approveGuide, currentGuide, listGuideVersions, proposeGuide, rejectGuide } from "@/lib/app-domain/extraction-guide";

// Org brain, decision 3: anybody proposes a version of the extraction
// guidance, an admin approves it, and the latest approved one is in use.

describe("extraction guidance", () => {
  it("is proposed by anyone, approved only by an admin, and never rolled back by an old draft", async () => {
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
    expect(await currentGuide()).toBeNull();

    const v1 = await proposeGuide(hadas, { body: "- רק מה שהלקוח אמר\n- בלי שמועות", note: "גרסה ראשונה" });
    const v2 = await proposeGuide(hadas, { body: "רק מה שהלקוח אמר במפורש", note: "חידוד" });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.body).toBe("רק מה שהלקוח אמר\nבלי שמועות");

    await expect(approveGuide(hadas, v2.id)).rejects.toBeInstanceOf(ForbiddenError);
    await approveGuide(ariel, v2.id);
    expect(await currentGuide()).toEqual({ version: 2, body: "רק מה שהלקוח אמר במפורש" });
    await expect(approveGuide(ariel, v1.id)).rejects.toThrow("חדשה יותר");
    await expect(rejectGuide(ariel, v1.id, " ")).rejects.toThrow("למה");
    await rejectGuide(ariel, v1.id, "הוחלפה בגרסה 2");
    expect((await listGuideVersions(hadas)).map((v) => [v.version, v.state])).toEqual([
      [2, "APPROVED"],
      [1, "REJECTED"],
    ]);
  });

  it("refuses empty guidance and guidance with a secret in it", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(proposeGuide(user, { body: " \n - \n" })).rejects.toThrow("ריקות");
    await expect(proposeGuide(user, { body: "password: hunter22 לדוגמה" })).rejects.toThrow("סיסמה");
  });
});

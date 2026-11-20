import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientFact, listClientFacts, supersedeClientFact } from "@/lib/app-domain/client-facts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";
import { previousVersions } from "@/lib/fact-versions";

// 20.11.2026 (Ariel): a fact shows the version it replaced, on the screen
// and in the file Claude reads.
describe("a fact's previous version", () => {
  it("is under the fact it led to, and in the file Claude reads", async () => {
    const client = await createTestClient({ name: "מאיה" });
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
    await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "x" });
    const v1 = await addClientFact(user, { clientId: client.id, kind: "NOTE", body: "חשבוניות דרך MAK", sources: [{ code: "S1" }] });
    const v2 = await supersedeClientFact(user, v1.id, { kind: "NOTE", body: "חשבוניות דרך MAK, ללקוח חו\"ל דרך השותפה", sources: [{ code: "S1" }] });
    const v3 = await supersedeClientFact(user, v2.id, { kind: "NOTE", body: "חשבוניות דרך MAK בין 10 ל-20 בחודש", sources: [{ code: "S1" }] });

    const facts = await listClientFacts(user, client.id);
    const { previous, orphans } = previousVersions(facts.current, facts.superseded);
    expect(previous.get(v3.id)!.map((v) => v.body)).toEqual(['חשבוניות דרך MAK, ללקוח חו"ל דרך השותפה', "חשבוניות דרך MAK"]);
    expect(orphans).toEqual([]);

    const file = toMarkdown(await buildClientFile(user, client.id, { audience: "ai" }));
    expect(file).toContain('גרסה קודמת (הוחלפה');
    expect(file).toContain('ללקוח חו"ל דרך השותפה');
  });
});

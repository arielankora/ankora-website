import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addProcess } from "@/lib/app-domain/processes";
import { handoverReadiness } from "@/lib/app-domain/handover-readiness";

// Spec 3.9 and 11: read through the screens' own readers, so a hidden
// system is not named and a stranger reads nothing.

const S1 = [{ code: "S1" }];

describe("handover readiness", () => {
  it("reads the client's processes and the access their systems need", async () => {
    const client = await createTestClient({ name: "NUX" });
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
    await addClientSource(user, { clientId: client.id, kind: "PERSON", title: "הדס" });
    const mercury = await addSystemAccess(user, { clientId: client.id, systemName: "Mercury", accessStatus: "NO_ACCESS", sources: S1 });
    await addProcess(user, {
      clientId: client.id,
      title: "תשלומי ספקים",
      sources: S1,
      transitionStatus: "IN_HANDOVER",
      requiredSystemIds: [mercury.id],
      requiredSystemPermissions: { [mercury.id]: "אישור תשלומים" },
      executorText: "גיא",
    });
    const r = await handoverReadiness(user, client.id);
    expect(r.total).toBe(1);
    expect(r.ready).toBe(0);
    expect(r.systemsWithoutAccess).toEqual([expect.objectContaining({ name: "Mercury", permission: "אישור תשלומים" })]);
    expect(r.processes[0].missing).toContain("עוד לא אצלנו: היום מבצע גיא.");

    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(handoverReadiness(stranger, client.id)).rejects.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser } from "./factories";
import { messageComposerProps } from "@/lib/app-domain/client-messages";

// The one query behind the "הודעה ללקוח" button.
//
// What it gathers decides whether the person about to write sees the
// sentence the client wrote about being written to, and whether the
// buttons point at a real number and a real address. Every one of those
// is a database fact, so this is where it is checked.

const PORTAL = "https://www.ankora.co.il/app/portal";

describe("what the person about to write is shown", () => {
  it("carries the client's own words, unread and uninterpreted", async () => {
    const client = await createTestClient({ name: "אורביט" });
    await prisma.client.update({
      where: { id: client.id },
      data: {
        // The sentence that killed the parser. It stays a sentence.
        preferenceContact: "וואטסאפ בלבד, לא מיילים",
        preferenceNever: "לא להתקשר אחרי 18:00",
        whatsappNumber: "050-1234567",
      },
    });

    const props = await messageComposerProps({ clientId: client.id, fromName: "הדס", portalUrl: PORTAL });

    expect(props!.preference).toBe("וואטסאפ בלבד, לא מיילים");
    expect(props!.never).toBe("לא להתקשר אחרי 18:00");
    expect(props!.whatsappDigits).toBe("972501234567");
    expect(props!.clientName).toBe("אורביט");
  });

  it("offers the addresses of people who could actually read it", async () => {
    const client = await createTestClient();
    await createTestClientUser({ clientId: client.id, role: "ADMIN", email: "admin@orbit.test" });
    // A viewer cannot answer a decision and is not who we write to about
    // one; a deleted admin is a bounce with somebody's name on it.
    await createTestClientUser({ clientId: client.id, role: "VIEWER", email: "viewer@orbit.test" });
    const gone = await createTestClientUser({ clientId: client.id, role: "ADMIN", email: "gone@orbit.test" });
    await prisma.user.update({ where: { id: gone.user.id }, data: { deletedAt: new Date() } });

    const props = await messageComposerProps({ clientId: client.id, fromName: "הדס" });

    expect(props!.emails).toEqual(["admin@orbit.test"]);
  });

  it("gives no button at all for a client that is not there", async () => {
    // A screen rendering a composer against a missing row would offer to
    // write to nobody, with somebody else's draft in the box.
    expect(await messageComposerProps({ clientId: "does-not-exist", fromName: "הדס" })).toBeNull();
  });

  it("writes every draft in the name of the person who will send it", async () => {
    const client = await createTestClient({ name: "אורביט" });
    const props = await messageComposerProps({
      clientId: client.id,
      fromName: "הדס",
      subject: "החלפת ספק ניקיון",
      portalUrl: PORTAL,
    });

    expect(props!.drafts.length).toBeGreaterThan(1);
    for (const draft of props!.drafts) {
      expect(draft.body.trimEnd().endsWith("הדס"), draft.kind).toBe(true);
    }
    const decision = props!.drafts.find((d) => d.kind === "decision_waiting")!;
    expect(decision.body).toContain(`${PORTAL}/decisions`);
  });

  it("says nothing about a task when the screen is not about one", async () => {
    // The client screen has no task in mind. A draft that names one
    // would be naming whichever task happened to be nearby.
    const client = await createTestClient({ name: "אורביט" });
    const props = await messageComposerProps({ clientId: client.id, fromName: "הדס" });

    for (const draft of props!.drafts) {
      expect(draft.body, draft.kind).not.toContain("undefined");
      expect(draft.body, draft.kind).not.toContain("null");
    }
  });
});

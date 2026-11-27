import { describe, expect, it } from "vitest";
import { mailboxState, readMailIntent, signMailIntent, type MailConnectIntent } from "@/lib/mail-scan/channels";

// "התיבות שלי" (27.11.2026): the signed way back from Unipile, and the step
// a mailbox is at, as on "חיבור ה-WhatsApp שלי" (comms-self-connect.test.ts).

const KEY = "test-key";
const intent: MailConnectIntent = { userId: "u1", channelId: null, issuedAt: 1_800_000_000_000 };

describe("mail-scan: the signed way back", () => {
  it("reads back what it signed, within the link's life, for a new mailbox and a reconnect", () => {
    expect(readMailIntent(signMailIntent(intent, KEY), intent.issuedAt + 10 * 60_000, KEY)).toEqual(intent);
    const reconnect = { ...intent, channelId: "ch1" };
    expect(readMailIntent(signMailIntent(reconnect, KEY), intent.issuedAt, KEY)).toEqual(reconnect);
  });

  it("refuses a changed cookie, another key, an expired one, garbage, and WhatsApp's cookie", () => {
    const cookie = signMailIntent(intent, KEY);
    const [body, sig] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ ...intent, userId: "u2" })).toString("base64url");
    expect(readMailIntent(`${forged}.${sig}`, intent.issuedAt, KEY)).toBeNull();
    expect(readMailIntent(`${body}.${sig}x`, intent.issuedAt, KEY)).toBeNull();
    expect(readMailIntent(cookie, intent.issuedAt, "other-key")).toBeNull();
    expect(readMailIntent(cookie, intent.issuedAt + 31 * 60_000, KEY)).toBeNull();
    expect(readMailIntent(undefined, intent.issuedAt, KEY)).toBeNull();
    expect(readMailIntent("not-a-cookie", intent.issuedAt, KEY)).toBeNull();
  });
});

describe("mail-scan: the step a mailbox is at", () => {
  const chosen = new Date();
  it("a disconnected mailbox says so first, whatever step it was at", () => {
    expect(mailboxState({ kindChosenAt: chosen, scanEnabled: true }, "disconnected")).toBe("disconnected");
    expect(mailboxState({ kindChosenAt: null, scanEnabled: false }, "errored")).toBe("disconnected");
  });

  it("then: whose it is, the switch, scanning", () => {
    expect(mailboxState({ kindChosenAt: null, scanEnabled: false }, "running")).toBe("choose-kind");
    expect(mailboxState({ kindChosenAt: chosen, scanEnabled: false }, "running")).toBe("not-scanning");
    expect(mailboxState({ kindChosenAt: chosen, scanEnabled: true }, "running")).toBe("scanning");
    expect(mailboxState({ kindChosenAt: chosen, scanEnabled: true }, null)).toBe("unknown");
  });
});

import { describe, it, expect } from "vitest";
import { needsReconnect, readIntent, signIntent, withAccount, type ConnectIntent } from "@/lib/comms/self-connect";

const KEY = "test-key";
const intent: ConnectIntent = { userId: "u1", mode: "new", accountId: null, issuedAt: 1_800_000_000_000 };

describe("self-connect: the signed way back", () => {
  it("reads back what it signed, within the link's life", () => {
    const cookie = signIntent(intent, KEY);
    expect(readIntent(cookie, intent.issuedAt + 10 * 60_000, KEY)).toEqual(intent);
  });

  it("refuses a changed cookie, another key, an expired one and garbage", () => {
    const cookie = signIntent(intent, KEY);
    const [body, sig] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ ...intent, userId: "u2" })).toString("base64url");
    expect(readIntent(`${forged}.${sig}`, intent.issuedAt, KEY)).toBeNull();
    expect(readIntent(`${body}.${sig}x`, intent.issuedAt, KEY)).toBeNull();
    expect(readIntent(cookie, intent.issuedAt, "other-key")).toBeNull();
    expect(readIntent(cookie, intent.issuedAt + 31 * 60_000, KEY)).toBeNull();
    expect(readIntent(undefined, intent.issuedAt, KEY)).toBeNull();
    expect(readIntent("not-a-cookie", intent.issuedAt, KEY)).toBeNull();
  });
});

describe("self-connect: the webhook's account list", () => {
  it("adds a new account to a list", () => {
    expect(withAccount(["acc_a", "acc_b"], "acc_c")).toEqual(["acc_a", "acc_b", "acc_c"]);
  });

  it("leaves a list that has it, or an empty list (every account), alone", () => {
    expect(withAccount(["acc_a", "acc_c"], "acc_c")).toBeNull();
    expect(withAccount([], "acc_c")).toBeNull();
  });
});

describe("self-connect: when to offer reconnecting", () => {
  it("asks to reconnect only when Unipile needs the user", () => {
    expect(needsReconnect("disconnected")).toBe(true);
    expect(needsReconnect("partial")).toBe(true);
    expect(needsReconnect("running")).toBe(false);
    expect(needsReconnect("errored")).toBe(false);
  });
});

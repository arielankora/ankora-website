import { beforeEach, describe, expect, it, vi } from "vitest";

// finishPasskeyRegistration tells the onboarding task a passkey exists,
// and a failure there never touches the registration itself.

const db = {
  webAuthnChallenge: {
    findMany: vi.fn(async () => [{ challenge: "ch", expiresAt: new Date(Date.now() + 60_000) }]),
    deleteMany: vi.fn(),
  },
  passkey: { create: vi.fn(async () => ({ id: "pk1" })) },
};
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/app-auth/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@simplewebauthn/server", () => ({
  verifyRegistrationResponse: async () => ({
    verified: true,
    registrationInfo: {
      credential: { id: "cred", publicKey: new Uint8Array([1]), counter: 0, transports: [] },
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
    },
  }),
  generateRegistrationOptions: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

const onPasskeyRegistered = vi.fn();
vi.mock("@/lib/app-domain/employee-lifecycle", () => ({ onPasskeyRegistered: (id: string) => onPasskeyRegistered(id) }));

const { finishPasskeyRegistration } = await import("@/lib/app-auth/passkeys");
const rp = { rpID: "localhost", rpName: "Ankora", origin: "http://localhost:3000" };
const actor = { id: "emp" } as never;

beforeEach(() => {
  onPasskeyRegistered.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("finishPasskeyRegistration and the onboarding task", () => {
  it("tells the onboarding hook after saving the passkey", async () => {
    await expect(finishPasskeyRegistration(actor, {} as never, "Mac", rp as never)).resolves.toEqual({ id: "pk1" });
    expect(onPasskeyRegistered).toHaveBeenCalledWith("emp");
  });

  it("still registers when the hook throws", async () => {
    onPasskeyRegistered.mockRejectedValue(new Error("boom"));
    await expect(finishPasskeyRegistration(actor, {} as never, "Mac", rp as never)).resolves.toEqual({ id: "pk1" });
  });
});

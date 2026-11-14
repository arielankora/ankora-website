import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// Blocks on call recordings (14.11.2026, Ariel's decision): a number
// blocked on a person's WhatsApp is not kept from that person's Aloha line,
// and only from that line. Unipile, Drive and OpenAI are replaced; the
// database is real.

const recordingFor = new Map<string, { from: string; to: string; callAt: string }>();
const transcribe = vi.fn();

vi.mock("@/lib/whatsapp-poc/recordings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatsapp-poc/recordings")>();
  return {
    ...real,
    fetchRecording: async (_config: unknown, emailId: string) => {
      const r = recordingFor.get(emailId);
      if (!r) return null;
      return {
        recording: { ...r, emailId, attachmentId: "a", sizeBytes: 1600 },
        audio: { bytes: new Uint8Array([0xff, 0xfb, 0x90, 0x64, ...new Array(15996).fill(0)]).buffer, contentType: "audio/mpeg" },
      };
    },
    fetchRecordingAudio: async () => ({ bytes: new ArrayBuffer(8), contentType: "audio/mpeg" }),
    listRecordingPage: async () => ({
      recordings: [...recordingFor.entries()].map(([emailId, r]) => ({ ...r, emailId, attachmentId: "a", sizeBytes: 1 })),
      nextCursor: null,
    }),
  };
});

vi.mock("@/lib/google-drive", () => ({
  uploadLargeFileToDriveFolder: async () => ({ ok: true, fileId: "drive-1" }),
  downloadFileFromDrive: async () => ({ ok: true, body: new ArrayBuffer(8) }),
  removeDriveFile: vi.fn(async () => ({ ok: true, how: "deleted" })),
}));

vi.mock("@/lib/whatsapp-poc/transcribe", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatsapp-poc/transcribe")>();
  return { ...real, transcribeHebrew: (...args: unknown[]) => transcribe(...args) };
});

import { reconcileRecordings, storeRecording, transcribePending } from "@/lib/comms/call-store";
import { decideBlock, requestBlock } from "@/lib/comms/whatsapp-store";

const HADAS_LINE = "+972553302266";
const ANNA_LINE = "+972553356775";
const FRIEND = "+972541111111";
const CLIENT = "+972542222222";

async function setup() {
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
  process.env.ALOHA_LINE_OWNERS = `${HADAS_LINE}=${hadas.email},${ANNA_LINE}=${anna.email}`;
  const hadasWa = await prisma.commsChannel.create({ data: { accountId: "acc_hadas", ownerUserId: hadas.id, storeEnabled: true } });
  return { hadas, anna, manager, hadasWa };
}

beforeEach(() => {
  recordingFor.clear();
  transcribe.mockReset();
  process.env.UNIPILE_API_KEY = "k";
  process.env.ALOHA_UNIPILE_ACCOUNT_ID = "acc_mail";
  process.env.ALOHA_LINE_NUMBER = `${HADAS_LINE},${ANNA_LINE}`;
  process.env.ALOHA_LINE_OWNERS = "";
  process.env.GOOGLE_DRIVE_FOLDER_CALL_RECORDINGS = "folder";
  process.env.OPENAI_API_KEY = "sk-test";
});

describe("blocks on call recordings", () => {
  it("does not keep a call blocked on the line owner's WhatsApp, and does not fetch it again", async () => {
    const { manager, hadasWa } = await setup();
    await requestBlock(manager, { channelId: hadasWa.id, kind: "PHONE", value: FRIEND, label: "חבר" });

    recordingFor.set("e1", { from: FRIEND, to: HADAS_LINE, callAt: "2026-11-14T08:00:00.000Z" });
    expect(await storeRecording("e1")).toBe("blocked");
    expect(await prisma.callRecording.count()).toBe(0);
    expect(await prisma.callRecordingSkip.count()).toBe(1);

    // The nightly reconcile counts it as handled.
    expect(await reconcileRecordings({ budgetMs: 60_000 })).toMatchObject({ stored: 0 });
  });

  it("keeps the same number on another person's line", async () => {
    const { manager, hadasWa } = await setup();
    await requestBlock(manager, { channelId: hadasWa.id, kind: "PHONE", value: FRIEND, label: "חבר" });

    recordingFor.set("e2", { from: FRIEND, to: ANNA_LINE, callAt: "2026-11-14T08:00:00.000Z" });
    expect(await storeRecording("e2")).toBe("stored");
  });

  it("removes calls already kept when a manager blocks the number", async () => {
    const { manager, hadasWa } = await setup();
    recordingFor.set("e3", { from: HADAS_LINE, to: FRIEND, callAt: "2026-11-13T08:00:00.000Z" });
    recordingFor.set("e4", { from: CLIENT, to: HADAS_LINE, callAt: "2026-11-13T09:00:00.000Z" });
    await reconcileRecordings({ budgetMs: 60_000 });
    expect(await prisma.callRecording.count()).toBe(2);

    const { block } = await requestBlock(manager, { channelId: hadasWa.id, kind: "PHONE", value: FRIEND, label: "חבר" });
    expect((await prisma.callRecording.findMany()).map((r) => r.otherPhone)).toEqual([CLIENT]);
    expect(await prisma.callRecordingSkip.findUnique({ where: { emailId: "e3" } })).not.toBeNull();
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: block.id } });
    expect(audit.afterJson).toMatchObject({ deletedCalls: 1 });
  });

  it("an employee's request holds the call's transcription, and the queue moves on; approval removes it", async () => {
    const { hadas, manager, hadasWa } = await setup();
    recordingFor.set("e5", { from: FRIEND, to: HADAS_LINE, callAt: "2026-11-13T08:00:00.000Z" });
    recordingFor.set("e6", { from: CLIENT, to: HADAS_LINE, callAt: "2026-11-13T09:00:00.000Z" });
    await reconcileRecordings({ budgetMs: 60_000 });

    const { block } = await requestBlock(hadas, { channelId: hadasWa.id, kind: "PHONE", value: FRIEND, label: "חבר" });
    transcribe.mockResolvedValue({ text: "שלום", model: "gpt-transcribe" });
    expect(await transcribePending({ budgetMs: 60_000 })).toMatchObject({ held: 1, done: 1 });
    expect(transcribe).toHaveBeenCalledTimes(1);

    await decideBlock(manager, block.id, true);
    expect((await prisma.callRecording.findMany()).map((r) => r.otherPhone)).toEqual([CLIENT]);
  });
});

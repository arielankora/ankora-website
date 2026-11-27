import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestClient } from "./factories";

// Communications storage, stage 2 (1.11.2026): a recording email is stored
// once, its transcript queued, a "בלי AI" client's number never sent, the
// spending cap leaves the queue waiting, and retention removes what the
// spec says. Unipile, Drive and OpenAI are replaced; the database is real.

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

import {
  reconcileRecordings,
  storeRecording,
  sweepCallRetention,
  transcribePending,
} from "@/lib/comms/call-store";
import { TranscriptionError } from "@/lib/whatsapp-poc/transcribe";
import { removeDriveFile } from "@/lib/google-drive";
import { retryDriveFileDeletions } from "@/lib/comms/drive-deletions";

const LINE = "+972553302266";
const CALLER = "+972541111111";

beforeEach(() => {
  recordingFor.clear();
  vi.mocked(removeDriveFile).mockResolvedValue({ ok: true, how: "deleted" });
  transcribe.mockReset();
  process.env.UNIPILE_API_KEY = "k";
  process.env.ALOHA_UNIPILE_ACCOUNT_ID = "acc_mail";
  process.env.ALOHA_LINE_NUMBER = LINE;
  process.env.GOOGLE_DRIVE_FOLDER_CALL_RECORDINGS = "folder";
  process.env.OPENAI_API_KEY = "sk-test";
});

describe("call recordings store", () => {
  it("stores a recording once, with its direction, length and a queued transcript", async () => {
    recordingFor.set("e1", { from: CALLER, to: LINE, callAt: "2026-11-01T08:00:00.000Z" });
    expect(await storeRecording("e1")).toBe("stored");
    expect(await storeRecording("e1")).toBe("exists");

    const rec = await prisma.callRecording.findUniqueOrThrow({ where: { emailId: "e1" }, include: { transcript: true } });
    expect(rec).toMatchObject({ otherPhone: CALLER, direction: "IN", driveFileId: "drive-1", durationSec: 1 });
    expect(rec.transcript?.status).toBe("PENDING");
  });

  it("transcribes the queue, and stops without spending an attempt at the cap", async () => {
    recordingFor.set("e1", { from: CALLER, to: LINE, callAt: "2026-11-01T08:00:00.000Z" });
    recordingFor.set("e2", { from: LINE, to: CALLER, callAt: "2026-11-01T09:00:00.000Z" });
    await reconcileRecordings({ budgetMs: 60_000 });
    expect(await prisma.callRecording.count()).toBe(2);

    transcribe.mockResolvedValueOnce({ text: "שלום", model: "gpt-transcribe" });
    transcribe.mockRejectedValueOnce(new TranscriptionError("cap", 429));
    const counts = await transcribePending({ budgetMs: 60_000 });
    expect(counts).toMatchObject({ done: 1, capped: 1 });

    const ts = await prisma.transcript.findMany({ orderBy: { createdAt: "asc" } });
    expect(ts.map((t) => [t.status, t.attempts])).toEqual([
      ["DONE", 0],
      ["PENDING", 0],
    ]);
  });

  // 25.11.2026: a refused transcription leaves its reason in lastError and
  // one line in the log (ids and codes, never the number), and stays in the
  // queue for the next try.
  it("records a refusal in lastError and the log, without the number", async () => {
    recordingFor.set("e1", { from: CALLER, to: LINE, callAt: "2026-11-01T08:00:00.000Z" });
    await storeRecording("e1");
    // A warning since 27.11.2026: one attempt's diagnostics. A transcript
    // that fails for good is a system issue.
    const errors = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    transcribe.mockRejectedValueOnce(new TranscriptionError("OpenAI החזיר שגיאה 400. gpt-transcribe 400 unsupported_parameter language", 400));

    expect(await transcribePending({ budgetMs: 60_000 })).toMatchObject({ retry: 1 });
    const tr = await prisma.transcript.findFirstOrThrow();
    expect(tr).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(tr.lastError).toContain("gpt-transcribe 400 unsupported_parameter language");

    const failed = errors.mock.calls.find((c) => c[0] === "transcribe: failed");
    expect(failed?.[1]).toMatchObject({ transcriptId: tr.id, source: "recording", attempt: 1, status: 400, code: "comms.transcription.failed", inDrive: true });
    expect(logs.mock.calls.some((c) => c[0] === "transcribe: start")).toBe(true);
    expect(JSON.stringify([...errors.mock.calls, ...logs.mock.calls])).not.toContain(CALLER);
    errors.mockRestore();
    logs.mockRestore();
  });

  // Found 27.11.2026 (silent failures audit): the 36 minute voice message of
  // 26.11 became FAILED after three tries and was never tried again, and
  // nobody was told. The spending cap left the queue waiting with no end.
  it("reports a transcript that fails for good, and the spending cap", async () => {
    recordingFor.set("e1", { from: CALLER, to: LINE, callAt: "2026-11-01T08:00:00.000Z" });
    await storeRecording("e1");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    transcribe.mockRejectedValue(new TranscriptionError("קובץ השמע לא נמצא.", null, "comms.transcription.audioNotFound"));
    for (let night = 0; night < 3; night++) await transcribePending({ budgetMs: 60_000 });
    const tr = await prisma.transcript.findFirstOrThrow();
    expect(tr.status).toBe("FAILED");
    const failed = await prisma.systemIssue.findFirstOrThrow({ where: { key: `transcribe:failed:${tr.id}` } });
    expect(failed).toMatchObject({ severity: "CRITICAL", count: 1 });
    expect(failed.detail).toContain("קובץ השמע לא נמצא");
    expect(JSON.stringify(failed)).not.toContain(CALLER);

    recordingFor.set("e2", { from: CALLER, to: LINE, callAt: "2026-11-02T08:00:00.000Z" });
    await storeRecording("e2");
    transcribe.mockRejectedValueOnce(new TranscriptionError("cap", 429));
    expect(await transcribePending({ budgetMs: 60_000 })).toMatchObject({ capped: 1 });
    expect(await prisma.systemIssue.count({ where: { key: "transcribe:capped", severity: "CRITICAL" } })).toBe(1);
    vi.restoreAllMocks();
  });

  it("never sends the number of a client marked בלי AI", async () => {
    const client = await createTestClient({ name: "חסוי" });
    await prisma.client.update({ where: { id: client.id }, data: { aiExcluded: true } });
    const person = await prisma.person.create({ data: { name: "דנה", phones: [CALLER] } });
    await prisma.clientContact.create({ data: { clientId: client.id, personId: person.id, role: "כספים" } });

    recordingFor.set("e1", { from: CALLER, to: LINE, callAt: "2026-11-01T08:00:00.000Z" });
    await storeRecording("e1");
    await transcribePending({ budgetMs: 60_000 });

    expect(transcribe).not.toHaveBeenCalled();
    expect((await prisma.transcript.findFirstOrThrow()).status).toBe("SKIPPED");
  });

  it("removes old audio, and a number in no client's file after 12 quiet months", async () => {
    recordingFor.set("old", { from: CALLER, to: LINE, callAt: "2025-01-01T08:00:00.000Z" });
    await storeRecording("old");
    const result = await sweepCallRetention(new Date("2026-11-01T00:00:00Z"));
    expect(result.recordingsRemoved).toBe(1);
    expect(await prisma.callRecording.count()).toBe(0);
  });

  // Found 27.11.2026 (silent failures audit). Was: the row was deleted
  // whatever Drive answered, so audio Drive refused to remove stayed there
  // with nothing left that knew its id.
  it("queues a Drive file it could not delete with its row, and the nightly retry removes it", async () => {
    recordingFor.set("old", { from: CALLER, to: LINE, callAt: "2025-01-01T08:00:00.000Z" });
    await storeRecording("old");
    vi.mocked(removeDriveFile).mockResolvedValue({ ok: false, error: "Drive delete failed 500" });

    const result = await sweepCallRetention(new Date("2026-11-01T00:00:00Z"));
    expect(result.recordingsRemoved).toBe(1);
    expect(await prisma.callRecording.count()).toBe(0);
    const queued = await prisma.driveFileDeletion.findUniqueOrThrow({ where: { fileId: "drive-1" } });
    expect(queued).toMatchObject({ reason: "call-quiet-number", lastError: "Drive delete failed 500" });

    vi.mocked(removeDriveFile).mockResolvedValue({ ok: true, how: "deleted" });
    expect(await retryDriveFileDeletions()).toEqual({ removed: 1, failed: 0 });
    expect(await prisma.driveFileDeletion.count()).toBe(0);
  });

  it("keeps the transcript of a client's old call, without its audio", async () => {
    const client = await createTestClient({ name: "לקוח" });
    const person = await prisma.person.create({ data: { name: "יוסי", phones: [CALLER] } });
    await prisma.clientContact.create({ data: { clientId: client.id, personId: person.id, role: "מנכ״ל" } });
    recordingFor.set("old", { from: CALLER, to: LINE, callAt: "2025-01-01T08:00:00.000Z" });
    await storeRecording("old");

    const result = await sweepCallRetention(new Date("2026-11-01T00:00:00Z"));
    expect(result).toEqual({ audioRemoved: 1, recordingsRemoved: 0 });
    const rec = await prisma.callRecording.findUniqueOrThrow({ where: { emailId: "old" } });
    expect(rec.driveFileId).toBeNull();
    expect(rec.audioDeletedAt).not.toBeNull();
  });
});

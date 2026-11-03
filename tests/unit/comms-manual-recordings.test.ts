import { describe, expect, it } from "vitest";
import { manualBatchLine, manualRecordingKey, manualRecordingStart } from "@/lib/comms/manual-recordings";
import { storedCallLine } from "@/lib/comms/call-lines";

describe("recordings Aloha sent by hand", () => {
  it("reads the line from the subject", () => {
    expect(manualBatchLine("הקלטות עבור המספר 0553356775")).toBe("+972553356775");
    expect(manualBatchLine("הקלטות עבור מספר 055-3356775")).toBe("+972553356775");
    expect(manualBatchLine("Call Recording [972541111111 => 972552222222]")).toBeNull();
    expect(manualBatchLine("שלום")).toBeNull();
  });

  it("takes the call time from the file name, and nothing else", () => {
    expect(manualRecordingStart("1792487791.9465.mp3")?.toISOString()).toBe("2026-10-20T09:16:31.000Z");
    expect(manualRecordingStart("1791124961.381700.mp3")).not.toBeNull();
    expect(manualRecordingStart("1791124961.mp3")).not.toBeNull();
    expect(manualRecordingStart("notes.mp3")).toBeNull();
    expect(manualRecordingStart("1792487791.wav")).toBeNull();
    expect(manualRecordingStart("123456789.mp3")).toBeNull();
  });

  it("keys each file of an email apart, and the same file the same way", () => {
    expect(manualRecordingKey("1a19baf5554d4a03", "1792487791.9465.mp3")).toBe("1a19baf5554d4a03.1792487791.9465");
    expect(manualRecordingKey("e", "1.mp3")).not.toBe(manualRecordingKey("e", "2.mp3"));
  });

  it("puts a hand-sent recording on its line", () => {
    const line = "+972553356775";
    expect(storedCallLine({ direction: "UNKNOWN", fromPhone: line, toPhone: line })).toBe(line);
  });
});

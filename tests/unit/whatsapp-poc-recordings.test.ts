import { describe, it, expect } from "vitest";
import { callSide, isSafeId, parseRecordingEmail, toRecording } from "@/lib/whatsapp-poc/recordings";

// The shape below is Aloha's email as it arrives in aloha@ (1.11.2026),
// with made-up numbers.
const SUBJECT = "Call Recording [972541111111 => 972552222222]";
const BODY = [
  "CALL RECORDING [972541111111 => 972552222222]",
  "",
  "Hi",
  "",
  "You have received a new call recording:",
  "",
  "From: 972541111111",
  "To: 972552222222",
  "Date: 29/10/2026 14:53:07",
].join("\n");

describe("WhatsApp POC: reading Aloha's recording emails", () => {
  it("takes both numbers in E.164 and the call time as Israel time", () => {
    // 29.10.2026 is after the clocks went back (25.10), so Israel is UTC+2.
    expect(parseRecordingEmail(SUBJECT, BODY)).toEqual({
      from: "+972541111111",
      to: "+972552222222",
      callAt: "2026-10-29T12:53:07.000Z",
    });
  });

  it("uses summer time before the change", () => {
    const body = BODY.replace("29/10/2026 14:53:07", "20/10/2026 09:00:00");
    expect(parseRecordingEmail(SUBJECT, body)?.callAt).toBe("2026-10-20T06:00:00.000Z");
  });

  it("falls back to the subject for the numbers", () => {
    const body = "Date: 29/10/2026 14:53:07";
    expect(parseRecordingEmail(SUBJECT, body)?.from).toBe("+972541111111");
  });

  it("refuses an email that is not a recording", () => {
    expect(parseRecordingEmail("חשבונית חדשה מ-Aloha", "החשבון שלך כבר כאן!")).toBeNull();
    expect(parseRecordingEmail(SUBJECT, "From: 972541111111\nTo: 972552222222")).toBeNull();
  });

  it("keeps only the audio attachment, never the inline logo", () => {
    const rec = toRecording({
      id: "1a187c2b2cbfd250",
      subject: SUBJECT,
      body_plain: BODY,
      attachments: [
        { id: "logo", mimetype: "image/png", is_inline: true, file_size: 99658 },
        { id: "audio-1", mimetype: "audio/mpeg", is_inline: false, file_size: 2540492 },
      ],
    });
    expect(rec).toMatchObject({ emailId: "1a187c2b2cbfd250", attachmentId: "audio-1", sizeBytes: 2540492 });
    expect(toRecording({ id: "x", subject: SUBJECT, body_plain: BODY, attachments: [] })).toBeNull();
  });
});

describe("WhatsApp POC: which way a call went", () => {
  const rec = { from: "+972541111111", to: "+972552222222", callAt: "2026-10-29T12:53:07.000Z" };

  it("sees an incoming and an outgoing call from our line", () => {
    expect(callSide(rec, "+972552222222")).toEqual({ direction: "in", other: "+972541111111" });
    expect(callSide(rec, "+972541111111")).toEqual({ direction: "out", other: "+972552222222" });
  });

  it("says it does not know when no line is set", () => {
    expect(callSide(rec, null).direction).toBe("unknown");
  });
});

describe("WhatsApp POC: ids passed to Unipile", () => {
  it("accepts Gmail ids and refuses anything that could change the path", () => {
    expect(isSafeId("1a187c2b2cbfd250")).toBe(true);
    expect(isSafeId("ANGjdJ_hdzBO-pTd")).toBe(true);
    expect(isSafeId("../emails")).toBe(false);
    expect(isSafeId("a/b")).toBe(false);
    expect(isSafeId("")).toBe(false);
  });
});

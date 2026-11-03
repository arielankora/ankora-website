import { normalizePhone } from "@/lib/contact-normalize";

// Recordings Aloha sent by hand (2.11.2026). For Anna's line, Aloha's staff
// mailed a batch of old recordings to aloha@ from a personal address:
//   Subject: "הקלטות עבור המספר 0553356775"
//   Body:    empty
//   Files:   one mp3 per call, named after its start in Unix seconds
//            ("1792487791.9465.mp3").
// No number of the other side, so they cannot be matched to a client. They
// are kept on the line's owner's view as calls whose other side is unknown,
// with their transcripts.
//
// Pure parsing here (unit tested); the import itself is in
// lib/comms/manual-import.ts.

/// The line a batch email is for, when its subject says so.
export function manualBatchLine(subject: string): string | null {
  const m = /הקלטות\s+עבור\s+(?:ה)?מספר\s*([0-9+\-\s]{9,16})/.exec(subject);
  if (!m) return null;
  const phone = normalizePhone(m[1].replace(/[\s-]/g, ""));
  return phone && /^\+\d{8,15}$/.test(phone) ? phone : null;
}

/// The call's start, from the file name, or null for a file that is not a
/// recording. Only plausible times (2020 to 2100) are taken.
export function manualRecordingStart(fileName: string): Date | null {
  const m = /^(\d{9,10})(?:\.\d+)?\.mp3$/i.exec(fileName.trim());
  if (!m) return null;
  const seconds = Number(m[1]);
  if (seconds < 1_577_836_800 || seconds > 4_102_444_800) return null;
  return new Date(seconds * 1000);
}

/// The stored row's key: the email and the file, so importing the same
/// email again finds every recording already there.
export function manualRecordingKey(emailId: string, fileName: string): string {
  return `${emailId}.${fileName.replace(/\.mp3$/i, "").replace(/[^0-9.]/g, "")}`;
}

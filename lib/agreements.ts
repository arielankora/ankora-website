import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import type {
  AgreementChannel,
  AgreementKind,
  AgreementLinkPurpose,
  EmployeeLifecycleKind,
  UserRole,
} from "@prisma/client";

// Employee agreements: which text is current, what it hashes to, and the
// small decisions (who is gated, does a typed name match, is a link still
// good) that the screens and the domain layer both lean on.
//
// The texts live in content/agreements as one file per version. A new
// version is a new file and a change to CURRENT_AGREEMENTS below; the old
// file is never edited or removed, because every signature row carries a
// hash of the file it was taken over, and that hash has to keep resolving
// to the words the person actually saw.

export interface AgreementVersion {
  kind: AgreementKind;
  /// The human version string, as printed inside the text itself.
  version: string;
  /// File name under content/agreements.
  file: string;
  /// Title used on screen, in the PDF and in the Drive file name.
  title: string;
}

export const AGREEMENT_FILES: readonly AgreementVersion[] = [
  {
    kind: "CONFIDENTIALITY",
    version: "סודיות-1.0",
    file: "confidentiality-1.0.he.md",
    title: "התחייבות לסודיות ואבטחת מידע",
  },
  {
    kind: "DELETION_DECLARATION",
    version: "מחיקה-1.0",
    file: "deletion-declaration-1.0.he.md",
    title: "הצהרת מחיקה והחזרת ציוד",
  },
];

export const CURRENT_AGREEMENTS: Readonly<Record<AgreementKind, string>> = {
  CONFIDENTIALITY: "סודיות-1.0",
  DELETION_DECLARATION: "מחיקה-1.0",
};

export const AGREEMENT_KIND_LABEL: Readonly<Record<AgreementKind, string>> = {
  CONFIDENTIALITY: "התחייבות לסודיות",
  DELETION_DECLARATION: "הצהרת מחיקה",
};

export const AGREEMENT_CHANNEL_LABEL: Readonly<Record<AgreementChannel, string>> = {
  APP: "אישור במערכת",
  EMAIL_PDF: "PDF חתום במייל",
};

/// The Latin code of a version, printed in the footer of every page of
/// every agreement PDF: "ANKORA-CONF-1.0", "ANKORA-DEL-1.0".
///
/// Why a second name for the same version: text extracted from a Hebrew
/// PDF comes back with its runs reversed, so an agent reading a returned
/// PDF cannot reliably find "סודיות-1.0" in it. A Latin code with digits
/// extracts exactly as printed. Derived, never stored, so it cannot drift
/// from the version it names: the kind's short code plus the version's
/// number (the part after its last hyphen).
const KIND_CODE: Readonly<Record<AgreementKind, string>> = {
  CONFIDENTIALITY: "CONF",
  DELETION_DECLARATION: "DEL",
};

export function agreementCode(kind: AgreementKind, version: string): string {
  const number = version.slice(version.lastIndexOf("-") + 1);
  return `ANKORA-${KIND_CODE[kind]}-${number}`;
}

/// A registered version by its Hebrew version string or its Latin code,
/// for a caller (an agent reading a PDF) that may have either.
export function findAgreementByVersionOrCode(kind: AgreementKind, value: string): AgreementVersion | null {
  const v = value.trim();
  return (
    AGREEMENT_FILES.find((a) => a.kind === kind && (a.version === v || agreementCode(a.kind, a.version) === v.toUpperCase())) ??
    null
  );
}

/// An agreement kind from a URL segment or a short name, in the forms a
/// person or a link would write it.
export function kindFromParam(param: string): AgreementKind | null {
  const p = param.trim().toLowerCase().replace(/_/g, "-");
  if (p === "confidentiality" || p === "conf") return "CONFIDENTIALITY";
  if (p === "deletion-declaration" || p === "del") return "DELETION_DECLARATION";
  return null;
}

export function findAgreement(kind: AgreementKind, version: string): AgreementVersion | null {
  return AGREEMENT_FILES.find((a) => a.kind === kind && a.version === version) ?? null;
}

export function currentAgreement(kind: AgreementKind): AgreementVersion {
  const found = findAgreement(kind, CURRENT_AGREEMENTS[kind]);
  // A registry that names a version with no file is a deploy bug, and the
  // unit test pins it. Throwing here keeps it from ever becoming a
  // signature over an empty text.
  if (!found) throw new Error(`No agreement file for ${kind} ${CURRENT_AGREEMENTS[kind]}`);
  return found;
}

export function agreementPath(a: AgreementVersion): string {
  // process.cwd(), for the same reason lib/pdf.ts builds its font paths
  // this way: next.config.mjs's outputFileTracingIncludes is what puts
  // these files into the deployed routes that read them.
  return path.join(process.cwd(), "content", "agreements", a.file);
}

/// The exact file text. This string, byte for byte, is what is hashed.
export function loadAgreementText(a: AgreementVersion): string {
  return fs.readFileSync(agreementPath(a), "utf8");
}

export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/// The part of the file that is shown when signing in the app or printed
/// in the signed PDF. The file is written for paper as well: its preamble
/// has blank lines for a name and an ID number, and it ends in signature
/// tables. In the app those are replaced by form fields and by the
/// signature block, so the body starts at the first numbered section and
/// drops tables, the "חתימות" caption, and any heading left with nothing
/// under it. The hash is still taken over the whole file, so what was
/// agreed to is unambiguous.
export function agreementBody(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.startsWith("## "));
  const kept = (start === -1 ? lines : lines.slice(start)).filter(
    (l) => !l.trim().startsWith("|") && l.trim() !== "**חתימות**"
  );

  // Drop a heading whose section is now empty (the signature section).
  const out: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const line = kept[i];
    if (line.startsWith("## ")) {
      let j = i + 1;
      while (j < kept.length && kept[j].trim() === "") j++;
      if (j >= kept.length || kept[j].startsWith("## ")) {
        i = j - 1;
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/// Removes Markdown backslash escapes (the file writes its blank lines
/// as `\_\_\_`) so the text reads as it would on paper.
export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|"])/g, "$1");
}

// --- Name matching ------------------------------------------------------

function normalizeName(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/// Does the name the signer typed match the account's name? Loose on
/// purpose: spacing and letter case are not a statement about identity,
/// and refusing over them only teaches people to copy and paste. Anything
/// beyond that is a different name, and the form says so.
export function namesMatch(typed: string, expected: string): boolean {
  const a = normalizeName(typed);
  return a.length > 0 && a === normalizeName(expected);
}

// --- Gate -----------------------------------------------------------------

/// Pure decision behind the app gate: must this person sign before they
/// may continue? Client portal users are never gated; the undertaking is
/// for the people who hold every client's data.
export function mustSignConfidentiality(
  role: UserRole,
  signatures: { kind: AgreementKind; version: string; channel: AgreementChannel }[]
): boolean {
  if (role === "CLIENT_USER") return false;
  return !signatures.some(
    (s) => s.kind === "CONFIDENTIALITY" && s.version === CURRENT_AGREEMENTS.CONFIDENTIALITY && s.channel === "APP"
  );
}

/// Where the gate sends someone who has not signed.
export const CONFIDENTIALITY_SIGN_PATH = "/app/agreements/confidentiality";

/// The one query the gate runs on every staff page: this person's
/// confidentiality signatures, narrowed to what the decision reads.
export async function confidentialitySignatures(userId: string) {
  return prisma.employeeAgreement.findMany({
    where: { userId, kind: "CONFIDENTIALITY", version: CURRENT_AGREEMENTS.CONFIDENTIALITY, channel: "APP" },
    select: { kind: true, version: true, channel: true },
    take: 1,
  });
}

export async function hasSignedCurrent(
  userId: string,
  kind: AgreementKind,
  channel: AgreementChannel
): Promise<boolean> {
  const row = await prisma.employeeAgreement.findFirst({
    where: { userId, kind, version: CURRENT_AGREEMENTS[kind], channel },
    select: { id: true },
  });
  return row !== null;
}

// --- One-time links --------------------------------------------------------

export const SIGN_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashSignToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function newSignToken(): { raw: string; tokenHash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, tokenHash: hashSignToken(raw) };
}

export type SignLinkState = "valid" | "missing" | "used" | "expired";

/// Why a link cannot be used is kept internal: the page shows one calm
/// message for every non-valid state, so a guessed or forwarded token
/// learns nothing about whether it ever existed.
export function signLinkState(
  link: { usedAt: Date | null; expiresAt: Date } | null,
  now: Date = new Date()
): SignLinkState {
  if (!link) return "missing";
  if (link.usedAt) return "used";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

/// The state of a link for one purpose. A link issued for the other
/// purpose is "missing" here, so an upload link can never sign and a sign
/// link can never upload, and the page says nothing about why.
export function linkStateFor(
  link: { purpose: AgreementLinkPurpose; usedAt: Date | null; expiresAt: Date } | null,
  purpose: AgreementLinkPurpose,
  now: Date = new Date()
): SignLinkState {
  if (!link || link.purpose !== purpose) return "missing";
  return signLinkState(link, now);
}

// --- Uploading the signed PDF -------------------------------------------------

/// The same ceiling as every other document in a client's file.
export const MAX_SIGNED_PDF_BYTES = 4 * 1024 * 1024;

/// A PDF begins with "%PDF-". The browser's declared type and the file
/// name are what the person's machine says; these five bytes are what the
/// file is.
export function looksLikePdf(content: Buffer): boolean {
  return content.byteLength >= 5 && content.subarray(0, 5).toString("latin1") === "%PDF-";
}

/// Which lifecycle task a signed agreement belongs on.
export function lifecycleKindFor(kind: AgreementKind): EmployeeLifecycleKind {
  return kind === "CONFIDENTIALITY" ? "ONBOARDING" : "OFFBOARDING";
}

/// Does extracted text carry this version's Latin code? Whitespace and
/// the direction marks some extractors insert are ignored, because they
/// can land inside the code without changing what was printed.
export function textHasAgreementCode(text: string, code: string): boolean {
  const flat = text.replace(/[\s\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  return flat.includes(code);
}

/// `<kind>-<version>-<name>-<YYYY-MM-DD>.pdf`, date in Israel time.
/// Slashes would make Drive show a path, so they are replaced.
export function agreementFileName(kind: AgreementKind, version: string, name: string, signedAt: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(signedAt);
  const safe = (s: string) => s.replace(/[\\/]/g, "_").trim();
  return `${kind}-${safe(version)}-${safe(name)}-${day}.pdf`;
}

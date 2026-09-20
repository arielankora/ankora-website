import "server-only";
import { createSign, randomUUID } from "node:crypto";

// Phase 11 follow-up: uploads the two nightly backup attachments
// (Excel report + gzipped DB dump - see lib/app-domain/backup-export.ts)
// directly to Google Drive from THIS app, server-to-server, using a
// Google Cloud service account.
//
// Why this exists (reversing an earlier explicit decision): docs/adr/0001
// section 22.2 originally decided AGAINST putting Google API credentials
// in this app - the Drive upload was kept as a separate, Claude-side
// scheduled task that reads the nightly email via Gmail and re-uploads
// each attachment, specifically so no Google secret would need to live
// here. That relay broke twice in practice (see the project's Claude Doc
// "יומן ריצות" for both incidents): once on the ~10MB weekly code
// archive, once on the ~13KB nightly DB dump - both blocked by the same
// sandbox-level "cannot base64-encode this file for an outbound MCP
// call" security classifier, unrelated to file size and not something
// that classifier lets an agent work around. Since the failure mode is
// structural (an AI agent's sandboxed shell is deliberately not a
// reliable place to shuttle a raw backup's bytes through), the fix is to
// remove that hop entirely: the server that already generates both files
// uploads them itself. Ariel decided (2026-09-20) to accept trading the
// "no Google credential in this app" property for a backup path that
// does not depend on any Claude session or Ariel's own computer being
// online at 03:00.
//
// Scope kept as narrow as practical to limit what this new credential
// can do if it ever leaks: a dedicated service account (not a user's own
// OAuth token), granted access to ONLY the two destination folders below
// via Drive's normal folder-sharing (Editor, shared explicitly with the
// service account's email - not domain-wide delegation, not access to
// Ariel's whole Drive). The `drive` scope (rather than the narrower
// `drive.file`) is still required here because `drive.file` only grants
// a token access to files/folders the app itself created or that a user
// picked via Google's file picker - neither applies to uploading into a
// pre-existing folder Ariel created by hand and shared after the fact.
//
// No new npm dependency: the service-account JWT is signed with Node's
// built-in `crypto` module (RS256) rather than pulling in `googleapis`/
// `google-auth-library` for what is otherwise two REST calls - same
// "no new dependency for something this small" call already made for
// PR #42's rate limiting (see claude/security-review-2026-09.md).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
const SCOPE = "https://www.googleapis.com/auth/drive";

// Destination folders - not secrets, just IDs (same two folders the old
// Claude-side relay task wrote into; see the project's backup plan doc
// for the full Drive folder structure).
export const DRIVE_FOLDER_EXCEL_REPORTS = "1rco2ZnbDDZF_QxI79MdfwUrHfvH_0HBC"; // "דוחות יומיים - Excel"
export const DRIVE_FOLDER_DB_DUMPS = "1H4kXfsCuzF_vutlLdjhfjUG1xhmvHZ4p"; // "דאטהבייס - dumps"

export interface DriveUploadFileResult {
  ok: boolean;
  fileId?: string;
  error?: string;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Reads the service-account key pair from env. GOOGLE_DRIVE_SA_PRIVATE_KEY
// is stored in Vercel with literal `\n` escape sequences (the only way a
// multi-line PEM survives Vercel's env var UI intact) - unescaped here.
function readServiceAccountCredentials(): { clientEmail: string; privateKey: string } | null {
  const clientEmail = process.env.GOOGLE_DRIVE_SA_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY;
  if (!clientEmail || !rawKey) return null;
  return { clientEmail, privateKey: rawKey.replace(/\\n/g, "\n") };
}

// One access token per invocation - this runs once/night inside a single
// Vercel Cron invocation (two uploads), not a hot path, so no token
// caching layer is worth the complexity.
async function getAccessToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const creds = readServiceAccountCredentials();
  if (!creds) {
    return { ok: false, error: "GOOGLE_DRIVE_SA_CLIENT_EMAIL / GOOGLE_DRIVE_SA_PRIVATE_KEY not set" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: creds.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    signature = base64url(signer.sign(creds.privateKey));
  } catch (err: any) {
    return { ok: false, error: `Failed to sign JWT (check GOOGLE_DRIVE_SA_PRIVATE_KEY format): ${err?.message ?? err}` };
  }

  const assertion = `${signingInput}.${signature}`;

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Token exchange failed ${res.status}: ${errText}` };
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) {
      return { ok: false, error: "Token exchange response had no access_token" };
    }
    return { ok: true, token: body.access_token };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error exchanging JWT for access token" };
  }
}

// Builds a `multipart/related` body by hand (metadata JSON part + binary
// media part) - this is the one part of the Drive API that has no plain-
// fetch-friendly shortcut. Boundary is a random UUID so it can never
// collide with attachment bytes.
function buildMultipartBody(metadata: object, content: Buffer, mimeType: string, boundary: string): Buffer {
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
  );
  const closing = Buffer.from(`\r\n--${boundary}--`);
  return Buffer.concat([preamble, content, closing]);
}

/// Uploads one file into one Drive folder. Never throws - matches every
/// other outbound-integration module in this codebase (lib/email.ts,
/// lib/github.ts): callers always get a result object to log/report,
/// never an exception to handle.
export async function uploadFileToDriveFolder(params: {
  name: string;
  mimeType: string;
  content: Buffer;
  folderId: string;
}): Promise<DriveUploadFileResult> {
  const tokenResult = await getAccessToken();
  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error };
  }

  const boundary = randomUUID();
  const body = buildMultipartBody({ name: params.name, parents: [params.folderId] }, params.content, params.mimeType, boundary);

  try {
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Drive upload failed ${res.status}: ${errText}` };
    }
    const uploaded = (await res.json()) as { id?: string };
    return { ok: true, fileId: uploaded.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error uploading to Drive" };
  }
}

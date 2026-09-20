import "server-only";
import { randomUUID } from "node:crypto";

// Phase 11 follow-up: uploads the two nightly backup attachments
// (Excel report + gzipped DB dump - see lib/app-domain/backup-export.ts)
// directly to Google Drive from THIS app, server-to-server.
//
// Why this exists: docs/adr/0001 section 22.2 originally kept the Drive
// upload OUT of this repo - a separate Claude-side scheduled task read
// the nightly email via Gmail and re-uploaded each attachment - so that
// no Google credential would need to live here. That relay broke twice
// in practice on the same base64-encoding step (see the project's Claude
// Doc "יומן ריצות"), a structural limitation of shuttling backup bytes
// through an AI agent's sandbox rather than a fixable bug, so the upload
// moved here: the server that already generates both files uploads them
// itself.
//
// HOW IT AUTHENTICATES, and why that matters (section 22.8): this module
// holds NO secret. It authenticates with Workload Identity Federation -
// Vercel issues this deployment a short-lived, signed OIDC identity token
// at runtime (VERCEL_OIDC_TOKEN), Google's Security Token Service is
// configured to trust that issuer for this one Vercel project, and the
// resulting federated token is used to impersonate the dedicated service
// account for exactly one hour. Every value this module reads from the
// environment below is a public identifier, not a credential: there is no
// private key to leak, to rotate, or to expire.
//
// That is what makes this design compatible with section 22.2's original
// reasoning rather than a reversal of it. The first implementation of
// this module DID use a service-account private key in Vercel env vars,
// and 22.7 documented that as a deliberate tradeoff. It never shipped:
// Google's own secure-by-default organisation policy
// (iam.managed.disableServiceAccountKeyCreation) blocked creating that
// key, with the console pointing at federation as the correct
// alternative. The guardrail was right, and this is the design we should
// have reached for first.
//
// Trust is scoped at three independent levels, so a token minted for any
// other workload is useless here: Vercel signs tokens only for this team;
// the pool provider's attribute condition accepts only this project's
// subject claim; and the service account itself can only reach the two
// Drive folders below, which were shared with it individually as Editor
// (not domain-wide delegation, not Ariel's wider Drive).
//
// The `drive` scope (rather than the narrower `drive.file`) is required
// because `drive.file` only grants access to files the app itself created
// or that a user picked via Google's file picker - neither applies to
// uploading into a pre-existing folder Ariel created by hand and shared
// after the fact.
//
// No new npm dependency: both token exchanges are plain REST calls made
// with fetch, rather than pulling in `google-auth-library` - the same
// "no new dependency for something this small" call already made for
// PR #42's rate limiting (see claude/security-review-2026-09.md).

const STS_URL = "https://sts.googleapis.com/v1/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

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

interface FederationConfig {
  audience: string;
  serviceAccountEmail: string;
}

// All four of these are public identifiers, NOT secrets - see the doc
// comment above. They are read at call time rather than at module load so
// that tests (and any future caller) can set them per-case.
function readFederationConfig(): { ok: true; config: FederationConfig } | { ok: false; error: string } {
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;

  const missing = [
    !projectNumber && "GCP_PROJECT_NUMBER",
    !poolId && "GCP_WORKLOAD_IDENTITY_POOL_ID",
    !providerId && "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
    !serviceAccountEmail && "GCP_SERVICE_ACCOUNT_EMAIL",
  ].filter(Boolean);

  if (missing.length > 0) {
    return { ok: false, error: `Workload Identity Federation not configured - missing: ${missing.join(", ")}` };
  }

  return {
    ok: true,
    config: {
      audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
      serviceAccountEmail: serviceAccountEmail!,
    },
  };
}

// Step 1 of 2: hand Vercel's OIDC token to Google's Security Token
// Service, which verifies the signature against the trusted issuer and
// returns a short-lived federated token. This token is NOT yet allowed to
// touch Drive - it only proves "this really is the ankora-website
// production deployment".
async function exchangeOidcTokenForFederatedToken(
  audience: string,
  oidcToken: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(STS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audience,
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
        requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
        scope: CLOUD_PLATFORM_SCOPE,
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
        subjectToken: oidcToken,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `STS token exchange failed ${res.status}: ${errText}` };
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) {
      return { ok: false, error: "STS token exchange response had no access_token" };
    }
    return { ok: true, token: body.access_token };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error exchanging OIDC token with STS" };
  }
}

// Step 2 of 2: use the federated token to impersonate the dedicated
// service account, scoped to Drive only. This is where the actual Drive
// permission comes from, and it is the only thing the federated identity
// is allowed to do.
async function impersonateServiceAccount(
  serviceAccountEmail: string,
  federatedToken: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateAccessToken`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${federatedToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scope: [DRIVE_SCOPE], lifetime: "3600s" }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Service account impersonation failed ${res.status}: ${errText}` };
    }
    const body = (await res.json()) as { accessToken?: string };
    if (!body.accessToken) {
      return { ok: false, error: "Service account impersonation response had no accessToken" };
    }
    return { ok: true, token: body.accessToken };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error impersonating service account" };
  }
}

// One access token per invocation - this runs once/night inside a single
// Vercel Cron invocation (two uploads), not a hot path, so no token
// caching layer is worth the complexity.
async function getAccessToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const configResult = readFederationConfig();
  if (!configResult.ok) {
    return { ok: false, error: configResult.error };
  }

  // Injected by Vercel into every deployment that has OIDC federation
  // enabled. Absent when running locally or outside Vercel - in that case
  // the upload reports a clear error and the nightly email (an entirely
  // independent delivery path) still carries both attachments.
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  if (!oidcToken) {
    return {
      ok: false,
      error:
        "VERCEL_OIDC_TOKEN is not set - OIDC federation is either disabled for this project or this code is not running on Vercel",
    };
  }

  const federated = await exchangeOidcTokenForFederatedToken(configResult.config.audience, oidcToken);
  if (!federated.ok) {
    return federated;
  }

  return impersonateServiceAccount(configResult.config.serviceAccountEmail, federated.token);
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

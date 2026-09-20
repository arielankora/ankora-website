import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadFileToDriveFolder, DRIVE_FOLDER_EXCEL_REPORTS, DRIVE_FOLDER_DB_DUMPS } from "@/lib/google-drive";

// This module authenticates with Workload Identity Federation and holds no
// secret at all - see lib/google-drive.ts's doc comment and docs/adr/0001
// section 22.8. Every value below is a public identifier, so these tests
// need no key material, real or fake.
const FAKE_OIDC_TOKEN = "header.payload.signature";
const EXPECTED_AUDIENCE =
  "//iam.googleapis.com/projects/1234567890/locations/global/workloadIdentityPools/test-pool/providers/test-provider";

describe("google-drive", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GCP_PROJECT_NUMBER = "1234567890";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "test-pool";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "test-provider";
    process.env.GCP_SERVICE_ACCOUNT_EMAIL = "test@example.iam.gserviceaccount.com";
    process.env.VERCEL_OIDC_TOKEN = FAKE_OIDC_TOKEN;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  function upload(folderId: string = DRIVE_FOLDER_EXCEL_REPORTS) {
    return uploadFileToDriveFolder({
      name: "test.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: Buffer.from("hello"),
      folderId,
    });
  }

  it("exports the two known destination folder IDs unchanged", () => {
    expect(DRIVE_FOLDER_EXCEL_REPORTS).toBe("1rco2ZnbDDZF_QxI79MdfwUrHfvH_0HBC");
    expect(DRIVE_FOLDER_DB_DUMPS).toBe("1H4kXfsCuzF_vutlLdjhfjUG1xhmvHZ4p");
  });

  it("returns ok:false (never throws) and names every missing federation env var", async () => {
    delete process.env.GCP_PROJECT_NUMBER;
    delete process.env.GCP_SERVICE_ACCOUNT_EMAIL;

    const result = await upload();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GCP_PROJECT_NUMBER/);
    expect(result.error).toMatch(/GCP_SERVICE_ACCOUNT_EMAIL/);
    // The two that WERE set must not be reported as missing.
    expect(result.error).not.toMatch(/GCP_WORKLOAD_IDENTITY_POOL_ID/);
  });

  it("returns ok:false (never throws) when VERCEL_OIDC_TOKEN is absent, without calling out to Google", async () => {
    delete process.env.VERCEL_OIDC_TOKEN;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const result = await upload();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/VERCEL_OIDC_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns ok:false (never throws) when STS rejects the OIDC token", async () => {
    global.fetch = vi.fn(async (url: any) => {
      expect(String(url)).toContain("sts.googleapis.com/v1/token");
      return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 });
    }) as any;

    const result = await upload();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/STS token exchange failed 400/);
  });

  it("returns ok:false (never throws) when service account impersonation is denied", async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).includes("sts.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "federated-token" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "permission denied" } }), { status: 403 });
    }) as any;

    const result = await upload();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Service account impersonation failed 403/);
  });

  it("exchanges the Vercel OIDC token for the right audience, then impersonates the service account", async () => {
    const calls: { url: string; init: any }[] = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("sts.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "federated-token" }), { status: 200 });
      }
      if (String(url).includes("iamcredentials.googleapis.com")) {
        return new Response(JSON.stringify({ accessToken: "sa-access-token" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "uploaded-file-id-123" }), { status: 200 });
    }) as any;

    await upload();

    const stsCall = calls.find((c) => c.url.includes("sts.googleapis.com"))!;
    const stsBody = JSON.parse(stsCall.init.body);
    expect(stsBody.audience).toBe(EXPECTED_AUDIENCE);
    expect(stsBody.subjectToken).toBe(FAKE_OIDC_TOKEN);
    expect(stsBody.grantType).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(stsBody.subjectTokenType).toBe("urn:ietf:params:oauth:token-type:jwt");

    const impersonationCall = calls.find((c) => c.url.includes("iamcredentials.googleapis.com"))!;
    expect(impersonationCall.url).toContain("test%40example.iam.gserviceaccount.com:generateAccessToken");
    expect(impersonationCall.init.headers.Authorization).toBe("Bearer federated-token");
    // Impersonation must request Drive only - never cloud-platform, which
    // would hand the nightly backup job far more reach than it needs.
    expect(JSON.parse(impersonationCall.init.body).scope).toEqual(["https://www.googleapis.com/auth/drive"]);
  });

  it("on success, sends a multipart/related body with the right folder as parent and returns the new file id", async () => {
    const calls: { url: string; init: any }[] = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("sts.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "federated-token" }), { status: 200 });
      }
      if (String(url).includes("iamcredentials.googleapis.com")) {
        return new Response(JSON.stringify({ accessToken: "sa-access-token" }), { status: 200 });
      }
      if (String(url).includes("www.googleapis.com/upload/drive/v3/files")) {
        return new Response(JSON.stringify({ id: "uploaded-file-id-123" }), { status: 200 });
      }
      throw new Error("unexpected fetch to " + url);
    }) as any;

    const result = await uploadFileToDriveFolder({
      name: "ankora-database-dump-2026-09-21.json.gz",
      mimeType: "application/gzip",
      content: Buffer.from("gzipped-content-stand-in"),
      folderId: DRIVE_FOLDER_DB_DUMPS,
    });

    expect(result.ok).toBe(true);
    expect(result.fileId).toBe("uploaded-file-id-123");

    const uploadCall = calls.find((c) => c.url.includes("/upload/drive/v3/files"))!;
    expect(uploadCall).toBeTruthy();
    // Both destination folders live in a Shared drive; without this flag
    // Drive v3 cannot resolve the parent and the upload 404s.
    expect(uploadCall.url).toContain("supportsAllDrives=true");
    expect(uploadCall.init.headers.Authorization).toBe("Bearer sa-access-token");
    expect(uploadCall.init.headers["Content-Type"]).toMatch(/^multipart\/related; boundary=/);

    const bodyText = Buffer.isBuffer(uploadCall.init.body)
      ? uploadCall.init.body.toString("utf8")
      : String(uploadCall.init.body);
    expect(bodyText).toContain(DRIVE_FOLDER_DB_DUMPS);
    expect(bodyText).toContain("ankora-database-dump-2026-09-21.json.gz");
    expect(bodyText).toContain("gzipped-content-stand-in");
  });
});

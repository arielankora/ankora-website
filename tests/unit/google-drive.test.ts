import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getVercelOidcToken } from "@vercel/oidc";
import { uploadFileToDriveFolder, DRIVE_FOLDER_EXCEL_REPORTS, DRIVE_FOLDER_DB_DUMPS } from "@/lib/google-drive";

// Vercel hands the OIDC token to the running function through the request
// context, which only exists inside a real invocation - so it is mocked
// here. A previous version of this module read process.env.VERCEL_OIDC_TOKEN
// instead; that passed its tests and then failed in production with an
// empty token, which is why these tests now assert against this helper.
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: vi.fn() }));
const mockedGetToken = vi.mocked(getVercelOidcToken);

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
    mockedGetToken.mockResolvedValue(FAKE_OIDC_TOKEN as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.mocked(getVercelOidcToken).mockReset();
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

  it("returns ok:false (never throws) when no OIDC token is available, without calling out to Google", async () => {
    mockedGetToken.mockResolvedValue(undefined as any);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const result = await upload();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OIDC token/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns ok:false (never throws) when the request context itself throws", async () => {
    mockedGetToken.mockRejectedValue(new Error("no request context") as any);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const result = await upload();

    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads the token from the Vercel request context, not from process.env", async () => {
    // Regression guard: process.env.VERCEL_OIDC_TOKEN is empty at runtime in
    // a Vercel function. If this module ever goes back to reading it, the
    // context mock below would be ignored and this assertion would fail.
    process.env.VERCEL_OIDC_TOKEN = "stale-env-token-that-must-not-be-used";
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).includes("sts.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "federated-token" }), { status: 200 });
      }
      if (String(url).includes("iamcredentials.googleapis.com")) {
        return new Response(JSON.stringify({ accessToken: "sa-access-token" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }) as any;

    await upload();

    expect(mockedGetToken).toHaveBeenCalled();
    const stsCall = (global.fetch as any).mock.calls.find((c: any[]) => String(c[0]).includes("sts.googleapis.com"));
    expect(JSON.parse(stsCall[1].body).subjectToken).toBe(FAKE_OIDC_TOKEN);
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { uploadFileToDriveFolder, DRIVE_FOLDER_EXCEL_REPORTS, DRIVE_FOLDER_DB_DUMPS } from "@/lib/google-drive";

// A real (but throwaway, test-only) RSA key pair so createSign(...).sign()
// exercises the actual signing code path, not just its error branch.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

describe("google-drive", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_DRIVE_SA_CLIENT_EMAIL = "test@example.iam.gserviceaccount.com";
    // Real multi-line PEM, re-escaped the same way Vercel's env var UI
    // would force it to be stored - exercises the \n-unescaping path.
    process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY = privateKey.replace(/\n/g, "\\n");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("exports the two known destination folder IDs unchanged", () => {
    expect(DRIVE_FOLDER_EXCEL_REPORTS).toBe("1rco2ZnbDDZF_QxI79MdfwUrHfvH_0HBC");
    expect(DRIVE_FOLDER_DB_DUMPS).toBe("1H4kXfsCuzF_vutlLdjhfjUG1xhmvHZ4p");
  });

  it("returns ok:false (never throws) when the service-account env vars are missing", async () => {
    delete process.env.GOOGLE_DRIVE_SA_CLIENT_EMAIL;
    delete process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY;

    const result = await uploadFileToDriveFolder({
      name: "test.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: Buffer.from("hello"),
      folderId: DRIVE_FOLDER_EXCEL_REPORTS,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GOOGLE_DRIVE_SA_CLIENT_EMAIL/);
  });

  it("returns ok:false (never throws) when the private key is malformed", async () => {
    process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY = "not a real key";

    const result = await uploadFileToDriveFolder({
      name: "test.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: Buffer.from("hello"),
      folderId: DRIVE_FOLDER_EXCEL_REPORTS,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns ok:false (never throws) when the token endpoint rejects the JWT", async () => {
    global.fetch = vi.fn(async (url: any) => {
      expect(String(url)).toContain("oauth2.googleapis.com/token");
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }) as any;

    const result = await uploadFileToDriveFolder({
      name: "test.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: Buffer.from("hello"),
      folderId: DRIVE_FOLDER_EXCEL_REPORTS,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Token exchange failed 400/);
  });

  it("on success, sends a multipart/related body with the right folder as parent and returns the new file id", async () => {
    const calls: { url: string; init: any }[] = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), { status: 200 });
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

    const uploadCall = calls.find((c) => c.url.includes("/upload/drive/v3/files"));
    expect(uploadCall).toBeTruthy();
    expect(uploadCall!.init.headers.Authorization).toBe("Bearer fake-token");
    expect(uploadCall!.init.headers["Content-Type"]).toMatch(/^multipart\/related; boundary=/);

    const bodyText = Buffer.isBuffer(uploadCall!.init.body)
      ? uploadCall!.init.body.toString("utf8")
      : String(uploadCall!.init.body);
    expect(bodyText).toContain(DRIVE_FOLDER_DB_DUMPS);
    expect(bodyText).toContain("ankora-database-dump-2026-09-21.json.gz");
    expect(bodyText).toContain("gzipped-content-stand-in");
  });
});

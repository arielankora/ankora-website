import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectImageType } from "@/lib/image-signature";

// POST /api/admin/upload-image (security review 2026-11): the file's own
// bytes decide whether it is an image, and which extension it is saved
// under. A declared contentType is never enough on its own.

const github = vi.hoisted(() => ({ putFile: vi.fn(async (..._args: unknown[]) => undefined), isGithubConfigured: vi.fn(() => true) }));
const auth = vi.hoisted(() => ({ resolveBlogWriter: vi.fn(async () => ({ kind: "admin" })) }));
vi.mock("@/lib/github", () => github);
vi.mock("@/lib/blog-agent-auth", () => auth);

const { POST } = await import("@/app/api/admin/upload-image/route");

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const WEBP = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")];
const SVG = [...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')];
const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
const call = (contentType: string, bytes: number[]) =>
  POST(
    new Request("http://x/api/admin/upload-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType, dataBase64: `data:${contentType};base64,${b64(bytes)}`, slug: "post" }),
    })
  );

beforeEach(() => vi.clearAllMocks());

describe("detectImageType", () => {
  it("knows JPEG, PNG and WebP by their bytes, and nothing else", () => {
    expect(detectImageType(Uint8Array.from(JPEG))).toBe("image/jpeg");
    expect(detectImageType(Uint8Array.from(PNG))).toBe("image/png");
    expect(detectImageType(Uint8Array.from(WEBP))).toBe("image/webp");
    expect(detectImageType(Uint8Array.from(SVG))).toBeNull();
    expect(detectImageType(Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("AVI ")]))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});

describe("POST /api/admin/upload-image", () => {
  it("refuses an SVG that claims to be a PNG, and commits nothing", async () => {
    const res = await call("image/png", SVG);
    expect(res.status).toBe(400);
    expect(github.putFile).not.toHaveBeenCalled();
  });

  it("saves a real PNG as .png", async () => {
    const res = await call("image/png", PNG);
    expect(res.status).toBe(200);
    expect(github.putFile).toHaveBeenCalledTimes(1);
    expect(github.putFile.mock.calls[0][0]).toMatch(/^public\/blog\/post-\d+\.png$/);
  });

  it("saves a real JPEG declared as PNG under .jpg, by its bytes", async () => {
    const res = await call("image/png", JPEG);
    expect(res.status).toBe(200);
    expect(github.putFile.mock.calls[0][0]).toMatch(/\.jpg$/);
  });

  it("still refuses a declared type outside the list", async () => {
    expect((await call("image/svg+xml", PNG)).status).toBe(400);
    expect(github.putFile).not.toHaveBeenCalled();
  });
});

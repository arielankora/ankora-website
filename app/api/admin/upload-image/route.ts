import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/adminAuth";
import { putFile, isGithubConfigured } from "@/lib/github";
import { slugify } from "@/lib/blog-shared";

const ALLOWED_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: Request) {
  if (!isRequestAuthorized()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isGithubConfigured()) {
    return NextResponse.json(
      { error: "Publishing isn't configured yet (missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO)." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.dataBase64 || !body.contentType || !body.slug) {
    return NextResponse.json({ error: "Missing image data." }, { status: 400 });
  }

  const ext = ALLOWED_EXT[body.contentType];
  if (!ext) return NextResponse.json({ error: "Only JPEG, PNG, or WebP images are supported." }, { status: 400 });

  const base64 = String(body.dataBase64).split(",").pop() || "";
  if (base64.length > 8_000_000) {
    return NextResponse.json({ error: "Image is too large (max ~5MB)." }, { status: 400 });
  }

  const safeSlug = slugify(body.slug) || "cover";
  const filename = `${safeSlug}-${Date.now()}.${ext}`;
  const path = `public/blog/${filename}`;

  try {
    await putFile(path, base64, `blog: upload image for "${safeSlug}"`, true);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "GitHub upload failed." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, url: `/blog/${filename}` });
}

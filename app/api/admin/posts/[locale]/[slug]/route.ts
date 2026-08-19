import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/adminAuth";
import { getPostBySlug, postFilePath, serializePost } from "@/lib/blog";
import { BLOG_CATEGORY_SLUGS } from "@/lib/blog-shared";
import { putFile, deleteFile, isGithubConfigured } from "@/lib/github";
import type { Locale } from "@/content";

function parseLocale(v: string): Locale {
  return v === "en" ? "en" : "he";
}

export async function GET(request: Request, { params }: { params: { locale: string; slug: string } }) {
  if (!isRequestAuthorized()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const post = getPostBySlug(parseLocale(params.locale), params.slug);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post });
}

export async function PUT(request: Request, { params }: { params: { locale: string; slug: string } }) {
  if (!isRequestAuthorized()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isGithubConfigured()) {
    return NextResponse.json(
      { error: "Publishing isn't configured yet (missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO)." },
      { status: 503 }
    );
  }

  const locale = parseLocale(params.locale);
  const existing = getPostBySlug(locale, params.slug);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const title = String(body.title || existing.title).trim();
  const category = (BLOG_CATEGORY_SLUGS as readonly string[]).includes(body.category)
    ? body.category
    : existing.category;
  const content = typeof body.content === "string" ? body.content : existing.content;

  const fileContent = serializePost(
    {
      title,
      excerpt: String(body.excerpt ?? existing.excerpt),
      category,
      tags: Array.isArray(body.tags) ? body.tags : existing.tags,
      coverImage: body.coverImage ?? existing.coverImage,
      author: String(body.author ?? existing.author),
      publishedAt: body.publishedAt || existing.publishedAt,
      updatedAt: new Date().toISOString().slice(0, 10),
      draft: typeof body.draft === "boolean" ? body.draft : existing.draft,
    },
    content
  );

  try {
    await putFile(postFilePath(locale, params.slug), fileContent, `blog: update "${title}" (${locale})`);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "GitHub publish failed." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: { locale: string; slug: string } }) {
  if (!isRequestAuthorized()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isGithubConfigured()) {
    return NextResponse.json(
      { error: "Publishing isn't configured yet (missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO)." },
      { status: 503 }
    );
  }

  const locale = parseLocale(params.locale);
  try {
    await deleteFile(postFilePath(locale, params.slug), `blog: delete "${params.slug}" (${locale})`);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "GitHub delete failed." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

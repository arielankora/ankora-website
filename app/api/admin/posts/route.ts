import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/adminAuth";
import { getAllPosts, postFilePath, serializePost, slugify } from "@/lib/blog";
import { BLOG_CATEGORY_SLUGS } from "@/lib/blog-shared";
import { putFile, isGithubConfigured } from "@/lib/github";
import type { Locale } from "@/content";

export async function GET() {
  if (!isRequestAuthorized()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const posts = [
    ...getAllPosts("he", { includeDrafts: true }),
    ...getAllPosts("en", { includeDrafts: true }),
  ].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  return NextResponse.json({ posts, githubConfigured: isGithubConfigured() });
}

export async function POST(request: Request) {
  if (!isRequestAuthorized()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isGithubConfigured()) {
    return NextResponse.json(
      { error: "Publishing isn't configured yet (missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO)." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const locale: Locale = body.locale === "en" ? "en" : "he";
  const title = String(body.title || "").trim();
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  const slug = slugify(body.slug || title);
  if (!slug) return NextResponse.json({ error: "Couldn't derive a valid slug from the title." }, { status: 400 });

  const category = (BLOG_CATEGORY_SLUGS as readonly string[]).includes(body.category)
    ? body.category
    : "company-insights";

  const content = String(body.content || "");
  const publishedAt = body.publishedAt || new Date().toISOString().slice(0, 10);

  const fileContent = serializePost(
    {
      title,
      excerpt: String(body.excerpt || ""),
      category,
      tags: Array.isArray(body.tags) ? body.tags : [],
      coverImage: body.coverImage || null,
      author: String(body.author || "Ankora"),
      publishedAt,
      updatedAt: null,
      draft: !!body.draft,
    },
    content
  );

  try {
    await putFile(
      postFilePath(locale, slug),
      fileContent,
      `blog: publish "${title}" (${locale})`
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "GitHub publish failed." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, locale, slug });
}

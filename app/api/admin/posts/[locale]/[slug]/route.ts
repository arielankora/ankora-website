import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/adminAuth";
import { getPostBySlug, postFilePath, serializePost } from "@/lib/blog";
import { BLOG_CATEGORY_SLUGS, COVER_IMAGE_POSITIONS } from "@/lib/blog-shared";
import { putFile, deleteFile, isGithubConfigured } from "@/lib/github";
import type { Locale } from "@/content";

function parseLocale(v: string): Locale {
  return v === "en" ? "en" : "he";
}

// Security review (OWASP A01:2021 - Broken Access Control; CWE-22, "Path
// Traversal").
//
// `params.slug` arrives straight from the URL and was passed unvalidated
// into postFilePath(), which builds `content/blog/{locale}/{slug}.mdx`.
// A slug of "../../../../README" therefore resolved to a path outside the
// blog directory entirely - and the DELETE handler below, unlike PUT,
// never called getPostBySlug() first, so nothing confirmed the target was
// actually a blog post before handing the path to GitHub's Contents API.
// An authenticated admin session (or anyone who got one - see the missing
// brute-force protection fixed in app/api/admin/login/route.ts) could
// delete arbitrary .mdx files anywhere in the repository, and GET could
// read them.
//
// Real slugs are produced by slugify() in lib/blog-shared.ts, which only
// ever emits lowercase ASCII letters, digits and hyphens. Enforcing that
// same shape here closes the traversal at the boundary rather than trying
// to sanitize a path after the fact - no "." can appear at all, so
// neither "../" nor an encoded variant survives.
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isSafeSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 120 && SAFE_SLUG.test(slug);
}

// 404 rather than 400: a malformed slug and a slug that simply doesn't
// exist are the same thing from a caller's point of view, and saying
// "invalid slug" would confirm to a prober that the format check is what
// stopped them.
function rejectUnsafeSlug() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(
  request: Request,
  props: { params: Promise<{ locale: string; slug: string }> }
) {
  const params = await props.params;
  if (!(await isRequestAuthorized())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSafeSlug(params.slug)) return rejectUnsafeSlug();
  const post = getPostBySlug(parseLocale(params.locale), params.slug);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post });
}

export async function PUT(
  request: Request,
  props: { params: Promise<{ locale: string; slug: string }> }
) {
  const params = await props.params;
  if (!(await isRequestAuthorized())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isGithubConfigured()) {
    return NextResponse.json(
      { error: "Publishing isn't configured yet (missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO)." },
      { status: 503 }
    );
  }

  if (!isSafeSlug(params.slug)) return rejectUnsafeSlug();

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

  const coverImagePosition = (COVER_IMAGE_POSITIONS as readonly string[]).includes(body.coverImagePosition)
    ? body.coverImagePosition
    : existing.coverImagePosition;

  const fileContent = serializePost(
    {
      title,
      excerpt: String(body.excerpt ?? existing.excerpt),
      category,
      tags: Array.isArray(body.tags) ? body.tags : existing.tags,
      coverImage: body.coverImage ?? existing.coverImage,
      coverImagePosition,
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

export async function DELETE(
  request: Request,
  props: { params: Promise<{ locale: string; slug: string }> }
) {
  const params = await props.params;
  if (!(await isRequestAuthorized())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isGithubConfigured()) {
    return NextResponse.json(
      { error: "Publishing isn't configured yet (missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO)." },
      { status: 503 }
    );
  }

  if (!isSafeSlug(params.slug)) return rejectUnsafeSlug();

  const locale = parseLocale(params.locale);

  // Unlike PUT above, this handler used to call deleteFile() without ever
  // confirming the target existed as a blog post. Checking first means a
  // path that somehow gets past isSafeSlug still cannot reach anything
  // that is not a real post in this locale's blog directory.
  if (!getPostBySlug(locale, params.slug)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await deleteFile(postFilePath(locale, params.slug), `blog: delete "${params.slug}" (${locale})`);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "GitHub delete failed." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

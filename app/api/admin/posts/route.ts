import { NextResponse } from "next/server";
import { resolveBlogWriter, agentWriteRefusal, authorFor } from "@/lib/blog-agent-auth";
import { getAllPosts, getPostBySlug, postFilePath, serializePost, slugify } from "@/lib/blog";
import { BLOG_CATEGORY_SLUGS, COVER_IMAGE_POSITIONS } from "@/lib/blog-shared";
import { putFile, isGithubConfigured } from "@/lib/github";
import type { Locale } from "@/content";

export async function GET(request: Request) {
  const writer = await resolveBlogWriter(request);
  if (writer instanceof Response) return writer;

  const posts = [
    ...getAllPosts("he", { includeDrafts: true }),
    ...getAllPosts("en", { includeDrafts: true }),
  ].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  return NextResponse.json({ posts, githubConfigured: isGithubConfigured() });
}

export async function POST(request: Request) {
  const writer = await resolveBlogWriter(request);
  if (writer instanceof Response) return writer;
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

  // Creating over an existing file silently replaced it. The editor never
  // does that on purpose; an agent picking a slug that is already taken must
  // hear about it rather than overwrite someone's post.
  if (writer.kind === "agent" && getPostBySlug(locale, slug)) {
    return NextResponse.json({ error: `A ${locale} post with the slug "${slug}" already exists.` }, { status: 409 });
  }

  // The editor sends draft explicitly. An agent that leaves it out gets a draft.
  const draft = writer.kind === "agent" ? body.draft !== false : !!body.draft;
  const refusal = agentWriteRefusal(writer, { requestedDraft: draft });
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });

  const category = (BLOG_CATEGORY_SLUGS as readonly string[]).includes(body.category)
    ? body.category
    : "company-insights";

  const content = String(body.content || "");
  const publishedAt = body.publishedAt || new Date().toISOString().slice(0, 10);

  const coverImagePosition = (COVER_IMAGE_POSITIONS as readonly string[]).includes(body.coverImagePosition)
    ? body.coverImagePosition
    : "center";

  const fileContent = serializePost(
    {
      title,
      excerpt: String(body.excerpt || ""),
      category,
      tags: Array.isArray(body.tags) ? body.tags : [],
      coverImage: body.coverImage || null,
      coverImagePosition,
      author: authorFor(writer, locale, String(body.author || "Ankora")),
      publishedAt,
      updatedAt: null,
      draft,
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

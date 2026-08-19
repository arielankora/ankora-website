"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TurndownService from "turndown";
import type { BlogPost } from "@/lib/blog-shared";
import { BLOG_CATEGORY_SLUGS } from "@/lib/blog-shared";

// Converts pasted rich content (ChatGPT, Google Docs, Word, web pages) into
// clean Markdown so formatting survives copy-paste into the article body.
const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
});

// Kept in sync with lib/blog-shared.ts#slugify. Slugs are always ASCII -
// non-Latin characters in URLs cause inconsistent routing on Vercel.
function sanitizeSlugChars(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
function slugifyClient(input: string): string {
  const base = sanitizeSlugChars(input);
  return base || `post-${Date.now().toString(36)}`;
}

const TOOLBAR: { label: string; wrap: [string, string] }[] = [
  { label: "B", wrap: ["**", "**"] },
  { label: "I", wrap: ["_", "_"] },
  { label: "H2", wrap: ["\n## ", ""] },
  { label: "H3", wrap: ["\n### ", ""] },
  { label: "Link", wrap: ["[", "](https://)"] },
  { label: "List", wrap: ["\n- ", ""] },
];

export function PostEditor({
  mode,
  initial,
  basePath,
}: {
  mode: "new" | "edit";
  initial?: BlogPost;
  basePath: string;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState(initial?.title || "");
  const [slug, setSlug] = useState(initial?.slug || "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [locale, setLocale] = useState<"he" | "en">(initial?.locale || "he");
  const [category, setCategory] = useState(initial?.category || "company-insights");
  const [excerpt, setExcerpt] = useState(initial?.excerpt || "");
  const [author, setAuthor] = useState(initial?.author || "Ankora");
  const [publishedAt, setPublishedAt] = useState(initial?.publishedAt || new Date().toISOString().slice(0, 10));
  const [tags, setTags] = useState((initial?.tags || []).join(", "));
  const [draft, setDraft] = useState(initial?.draft ?? true);
  const [coverImage, setCoverImage] = useState(initial?.coverImage || "");
  const [content, setContent] = useState(initial?.content || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derivedSlug = useMemo(() => (slugTouched ? slug : slugifyClient(title)), [slugTouched, slug, title]);

  function insertAtCursor(before: string, after: string) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const next = content.slice(0, start) + before + selected + after + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + before.length;
      el.selectionEnd = start + before.length + selected.length;
    });
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const html = e.clipboardData.getData("text/html");
    // No rich HTML on the clipboard (e.g. copying from another plain-text
    // editor) - fall back to the browser's normal plain-text paste.
    if (!html || !html.trim()) return;

    e.preventDefault();
    const markdown = turndownService.turndown(html).trim();
    const el = textareaRef.current;
    if (!el) {
      setContent((prev) => prev + markdown);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = content.slice(0, start) + markdown + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + markdown.length;
      el.selectionStart = pos;
      el.selectionEnd = pos;
    });
  }

  async function onUploadImage(file: File) {
    setUploading(true);
    setError(null);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/admin/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataBase64, contentType: file.type, slug: derivedSlug || "cover" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed.");
      setCoverImage(json.url);
    } catch (e: any) {
      setError(e.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      title,
      slug: derivedSlug,
      locale,
      category,
      excerpt,
      author,
      publishedAt,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      draft,
      coverImage: coverImage || null,
      content,
    };

    try {
      const res =
        mode === "new"
          ? await fetch("/api/admin/posts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/admin/posts/${initial!.locale}/${initial!.slug}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed.");
      router.push(basePath);
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Save failed.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-medium text-navy">{mode === "new" ? "New article" : "Edit article"}</h1>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-navy/70">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-navy/70">Slug (URL)</label>
          <input
            value={derivedSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(sanitizeSlugChars(e.target.value));
            }}
            disabled={mode === "edit"}
            className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold disabled:bg-navy/5 disabled:text-navy/40"
          />
          <p className="mt-1 text-xs text-navy/40">
            /{locale}/blog/{derivedSlug || "…"} &middot; Latin letters, numbers and hyphens only (Hebrew titles are fine - just not in the URL)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-navy/70">Language</label>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as "he" | "en")}
            disabled={mode === "edit"}
            className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold disabled:bg-navy/5"
          >
            <option value="he">Hebrew</option>
            <option value="en">English</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-navy/70">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as any)}
            className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
          >
            {BLOG_CATEGORY_SLUGS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-navy/70">Excerpt (meta description, 1-2 sentences)</label>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-navy/70">Author</label>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-navy/70">Publish date</label>
          <input
            type="date"
            value={publishedAt}
            onChange={(e) => setPublishedAt(e.target.value)}
            className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-navy/70">Tags (comma separated, optional)</label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-2.5 text-navy outline-none focus:border-gold"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-navy/70">Cover image</label>
          <div className="mt-2 flex items-center gap-4">
            {coverImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverImage} alt="" className="h-16 w-24 rounded-lg object-cover" />
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => e.target.files?.[0] && onUploadImage(e.target.files[0])}
              disabled={uploading}
            />
            {uploading && <span className="text-sm text-navy/40">Uploading…</span>}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <label className="block text-sm font-medium text-navy/70">Article body (Markdown)</label>
        <div className="mt-2 flex gap-1">
          {TOOLBAR.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => insertAtCursor(t.wrap[0], t.wrap[1])}
              className="rounded-md border border-lineDark bg-white px-3 py-1.5 text-xs font-medium text-navy/70 hover:border-gold"
            >
              {t.label}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={handlePaste}
          rows={18}
          dir="auto"
          className="mt-2 w-full rounded-lg border border-lineDark bg-white px-4 py-3 font-mono text-sm text-navy outline-none focus:border-gold"
        />
        <p className="mt-1 text-xs text-navy/40">
          Paste directly from ChatGPT, Google Docs, or Word - headings, bold, links and lists convert to Markdown automatically.
        </p>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <input id="draft" type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        <label htmlFor="draft" className="text-sm text-navy/70">
          Save as draft (won&apos;t appear on the live site or sitemap until unchecked)
        </label>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-8 flex items-center gap-4">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-gold-gradient px-7 py-3 text-sm font-medium text-ink disabled:opacity-50"
        >
          {saving ? "Saving…" : draft ? "Save draft" : "Publish"}
        </button>
        <span className="text-xs text-navy/40">
          {draft ? "Draft posts are private until you publish them." : "This will go live on ankora.co.il within about a minute."}
        </span>
      </div>
    </form>
  );
}

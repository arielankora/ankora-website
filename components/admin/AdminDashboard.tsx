"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BlogPostMeta } from "@/lib/blog-shared";

export function AdminDashboard({
  posts,
  basePath,
  githubConfigured,
}: {
  posts: BlogPostMeta[];
  basePath: string;
  githubConfigured: boolean;
}) {
  const router = useRouter();
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDelete(locale: string, slug: string, title: string) {
    if (!confirm(`Delete "${title}"? This removes it from the live site.`)) return;
    setBusySlug(`${locale}/${slug}`);
    setError(null);
    try {
      const res = await fetch(`/api/admin/posts/${locale}/${slug}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Delete failed.");
        setBusySlug(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusySlug(null);
    }
  }

  async function onLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push(`${basePath}/login`);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium text-navy">Blog admin</h1>
          <p className="mt-1 text-sm text-navy/50">{posts.length} article{posts.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`${basePath}/posts/new`}
            className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-ink"
          >
            New article
          </Link>
          <button onClick={onLogout} className="text-sm text-navy/50 hover:text-navy">
            Log out
          </button>
        </div>
      </div>

      {!githubConfigured && (
        <div className="mt-6 rounded-xl border border-amber-400/50 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Publishing isn&apos;t connected yet. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO in your environment
          to enable creating, editing, and deleting articles.
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-8 overflow-hidden rounded-2xl border border-lineDark">
        {posts.length === 0 ? (
          <div className="px-8 py-16 text-center text-navy/40">No articles yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-navy/5 text-start text-xs uppercase tracking-wide text-navy/40">
              <tr>
                <th className="px-5 py-3 text-start">Title</th>
                <th className="px-5 py-3 text-start">Locale</th>
                <th className="px-5 py-3 text-start">Category</th>
                <th className="px-5 py-3 text-start">Status</th>
                <th className="px-5 py-3 text-start">Date</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => {
                const key = `${post.locale}/${post.slug}`;
                return (
                  <tr key={key} className="border-t border-lineDark">
                    <td className="px-5 py-3 font-medium text-navy">{post.title}</td>
                    <td className="px-5 py-3 uppercase text-navy/50">{post.locale}</td>
                    <td className="px-5 py-3 text-navy/60">{post.category}</td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          post.draft
                            ? "rounded-full bg-navy/10 px-2.5 py-1 text-xs text-navy/60"
                            : "rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-700"
                        }
                      >
                        {post.draft ? "Draft" : "Published"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-navy/50">{post.publishedAt}</td>
                    <td className="px-5 py-3 text-end">
                      <Link
                        href={`${basePath}/posts/edit?locale=${post.locale}&slug=${post.slug}`}
                        className="me-4 text-gold-dim hover:underline"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => onDelete(post.locale, post.slug, post.title)}
                        disabled={busySlug === key}
                        className="text-red-600 hover:underline disabled:opacity-40"
                      >
                        {busySlug === key ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

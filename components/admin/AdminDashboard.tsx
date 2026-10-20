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
          <h1 className="text-2xl font-medium text-app-text-primary">Blog admin</h1>
          <p className="mt-1 text-sm text-app-text-tertiary">{posts.length} article{posts.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`${basePath}/posts/new`}
            className="rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy"
          >
            New article
          </Link>
          <button onClick={onLogout} className="text-sm text-app-text-tertiary hover:text-app-text-primary">
            Log out
          </button>
        </div>
      </div>

      {!githubConfigured && (
        <div className="mt-6 rounded-xl border border-app-warning/40 bg-app-warning-soft px-5 py-4 text-sm text-app-warning">
          Publishing isn&apos;t connected yet. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO in your environment
          to enable creating, editing, and deleting articles.
        </div>
      )}

      {error && <p className="mt-4 text-sm text-app-error">{error}</p>}

      <div className="mt-8 overflow-hidden rounded-2xl border border-app-border">
        {posts.length === 0 ? (
          <div className="px-8 py-16 text-center text-app-text-tertiary">No articles yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-app-surface-sunken text-start text-xs uppercase tracking-wide text-app-text-tertiary">
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
                  <tr key={key} className="border-t border-app-border">
                    <td className="px-5 py-3 font-medium text-app-text-primary">{post.title}</td>
                    <td className="px-5 py-3 uppercase text-app-text-tertiary">{post.locale}</td>
                    <td className="px-5 py-3 text-app-text-secondary">{post.category}</td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          post.draft
                            ? "rounded-full bg-app-surface-sunken px-2.5 py-1 text-xs text-app-text-secondary"
                            : "rounded-full bg-app-success-soft px-2.5 py-1 text-xs text-app-success"
                        }
                      >
                        {post.draft ? "Draft" : "Published"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-app-text-tertiary">{post.publishedAt}</td>
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
                        className="text-app-error hover:underline disabled:opacity-40"
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

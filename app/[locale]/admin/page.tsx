import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isValidSessionToken, ADMIN_COOKIE } from "@/lib/adminAuth";
import { getAllPosts } from "@/lib/blog";
import { isGithubConfigured } from "@/lib/github";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function AdminHomePage({ params }: { params: { locale: string } }) {
  const locale = params.locale === "en" ? "en" : "he";
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!isValidSessionToken(token)) redirect(`/${locale}/admin/login`);

  const posts = [
    ...getAllPosts("he", { includeDrafts: true }),
    ...getAllPosts("en", { includeDrafts: true }),
  ].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  return (
    <div className="bg-paper px-6 py-32">
      <div className="mx-auto max-w-content">
        <AdminDashboard posts={posts} basePath={`/${locale}/admin`} githubConfigured={isGithubConfigured()} />
      </div>
    </div>
  );
}

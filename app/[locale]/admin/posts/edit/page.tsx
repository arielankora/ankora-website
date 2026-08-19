import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { isValidSessionToken, ADMIN_COOKIE } from "@/lib/adminAuth";
import { getPostBySlug } from "@/lib/blog";
import { PostEditor } from "@/components/admin/PostEditor";
import type { Locale } from "@/content";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function EditPostPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { locale?: string; slug?: string };
}) {
  const locale = params.locale === "en" ? "en" : "he";
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!isValidSessionToken(token)) redirect(`/${locale}/admin/login`);

  const postLocale: Locale = searchParams.locale === "en" ? "en" : "he";
  const slug = searchParams.slug || "";
  const post = getPostBySlug(postLocale, slug);
  if (!post) notFound();

  return (
    <div className="bg-paper px-6 py-32">
      <PostEditor mode="edit" initial={post} basePath={`/${locale}/admin`} />
    </div>
  );
}

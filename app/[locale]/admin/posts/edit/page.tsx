import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { isValidSessionToken, ADMIN_COOKIE } from "@/lib/adminAuth";
import { getPostBySlug } from "@/lib/blog";
import { PostEditor } from "@/components/admin/PostEditor";
import type { Locale } from "@/content";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditPostPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ locale?: string; slug?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const locale = params.locale === "en" ? "en" : "he";
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!isValidSessionToken(token)) redirect(`/${locale}/admin/login`);

  const postLocale: Locale = searchParams.locale === "en" ? "en" : "he";
  const slug = searchParams.slug || "";
  const post = getPostBySlug(postLocale, slug);
  if (!post) notFound();

  return (
    <div className="bg-cream px-6 py-32">
      <PostEditor mode="edit" initial={post} basePath={`/${locale}/admin`} />
    </div>
  );
}

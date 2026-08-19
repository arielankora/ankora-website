import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isValidSessionToken, ADMIN_COOKIE } from "@/lib/adminAuth";
import { PostEditor } from "@/components/admin/PostEditor";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function NewPostPage({ params }: { params: { locale: string } }) {
  const locale = params.locale === "en" ? "en" : "he";
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!isValidSessionToken(token)) redirect(`/${locale}/admin/login`);

  return (
    <div className="bg-paper px-6 py-32">
      <PostEditor mode="new" basePath={`/${locale}/admin`} />
    </div>
  );
}

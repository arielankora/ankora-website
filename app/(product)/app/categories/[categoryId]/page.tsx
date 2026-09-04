import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { EditCategoryForm } from "./EditCategoryForm";

export const metadata = { robots: { index: false, follow: false } };

export default async function CategoryDetailPage({ params }: { params: { categoryId: string } }) {
  const user = await requireUser();

  if (!can(user.role, "category.manage")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const category = await prisma.category.findFirst({
    where: { id: params.categoryId, deletedAt: null },
    include: { client: true },
  });
  if (!category) notFound();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Link href="/app/categories" className="text-xs text-navy/50 hover:text-gold-dim">
            ← חזרה לרשימת הקטגוריות
          </Link>
          <h1 className="mt-2 text-xl font-medium text-navy">{category.name}</h1>
          <p className="mt-1 text-sm text-navy/60">
            {category.visibility === "GLOBAL" ? "קטגוריה כללית" : `ספציפית ללקוח: ${category.client?.name ?? ""}`}
          </p>
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <EditCategoryForm category={category} />
        </div>
      </div>
    </AppShell>
  );
}

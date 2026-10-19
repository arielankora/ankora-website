import { PageBack } from "@/components/app/BackSlot";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { Forbidden } from "@/components/app/Forbidden";
import { EditCategoryForm } from "./EditCategoryForm";

export const metadata = { robots: { index: false, follow: false } };

export default async function CategoryDetailPage(props: { params: Promise<{ categoryId: string }> }) {
  const params = await props.params;
  const user = await requireUser();

  if (!can(user.role, "category.manage")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const category = await prisma.category.findFirst({
    where: { id: params.categoryId, deletedAt: null },
    include: { client: true },
  });
  if (!category) notFound();

  return (
    <>
      <div className="space-y-6">
        <div>
          <PageBack href="/app/categories" label="קטגוריות" />
          <h1 className="mt-3 text-xl font-medium text-app-text-primary">{category.name}</h1>
          <p className="mt-1 text-sm text-app-text-secondary">
            {category.visibility === "GLOBAL" ? "קטגוריה כללית" : `ספציפית ללקוח: ${category.client?.name ?? ""}`}
          </p>
        </div>

        <div className="rounded-2xl border border-app-border bg-white p-6">
          <EditCategoryForm category={category} />
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listCategories } from "@/lib/app-domain/categories";
import { listClients } from "@/lib/app-domain/clients";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { CreateCategoryForm } from "./CreateCategoryForm";
import { archiveCategoryAction } from "./actions";

export const metadata = { robots: { index: false, follow: false } };

export default async function CategoriesPage() {
  const user = await requireUser();

  if (!can(user.role, "category.manage")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const [categories, clients] = await Promise.all([
    listCategories(),
    listClients(),
  ]);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">קטגוריות</h1>
          <p className="mt-1 text-sm text-navy/60">קטגוריות עבודה כלליות וייעודיות ללקוח.</p>
        </div>

        <CreateCategoryForm clients={clients.filter((c) => c.status === "ACTIVE")} />

        <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead>
              <tr className="border-b border-lineDark text-xs text-navy/50">
                <th className="px-5 py-3 font-medium">שם</th>
                <th className="px-5 py-3 font-medium">היקף</th>
                <th className="px-5 py-3 font-medium">סטטוס</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-navy/50">
                    אין עדיין קטגוריות. הוסיפו קטגוריה ראשונה למעלה.
                  </td>
                </tr>
              )}
              {categories.map((cat) => (
                <tr key={cat.id} className="border-b border-lineDark last:border-0">
                  <td className="px-5 py-3">
                    <Link href={`/app/categories/${cat.id}`} className="font-medium text-navy hover:text-gold-dim">
                      {cat.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-navy/70">
                    {cat.visibility === "GLOBAL" ? "כללית" : cat.client?.name ?? "ספציפית ללקוח"}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge label={cat.active ? "פעילה" : "לא פעילה"} tone={cat.active ? "green" : "gray"} />
                  </td>
                  <td className="px-5 py-3 text-end">
                    <form action={archiveCategoryAction}>
                      <input type="hidden" name="categoryId" value={cat.id} />
                      <button type="submit" className="text-xs text-navy/50 hover:text-red-600">
                        העברה לארכיון
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

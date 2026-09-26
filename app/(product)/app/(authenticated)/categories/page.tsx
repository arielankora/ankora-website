import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listCategories, getCategoryMonthlyHours } from "@/lib/app-domain/categories";
import { listClients } from "@/lib/app-domain/clients";
import { Forbidden } from "@/components/app/Forbidden";
import { Drawer } from "@/components/app/Drawer";
import { CreateCategoryForm } from "./CreateCategoryForm";

export const metadata = { robots: { index: false, follow: false } };

// A short, repeating palette for the leading color dot - purely
// decorative (the schema has no color field on Category, and the
// prototype's own dot colors were index-based, not stored data), cycling
// so a long list stays visually distinguishable without every dot being
// gold.
const DOT_COLORS = ["#B08D57", "#C7AC7E", "rgba(27,42,61,.42)", "rgba(176,141,87,.55)", "rgba(27,42,61,.2)"];

function formatHM(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

// App redesign (handoff README, screen 6 "קטגוריות"): "טבלה: נקודת צבע +
// שם, היקף (גלובלית / שם לקוח), שעות החודש, סטטוס." Note what's
// deliberately NOT here: the old per-row "העברה לארכיון" button. Neither
// the README's screen-6 bullet nor the prototype's markup include a
// row action for this screen at all - it's a plain read-oriented table.
// (Editing/archiving a category still happens on its own detail page,
// categories/[categoryId]/page.tsx, unchanged by this pass.)
export default async function CategoriesPage() {
  const user = await requireUser();

  if (!can(user.role, "category.manage")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const [categories, clients, monthlyHours] = await Promise.all([
    listCategories(),
    listClients(),
    getCategoryMonthlyHours(),
  ]);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-appNavy">קטגוריות</h1>
            <p className="mt-1 text-sm text-appNavy/60">
              קטגוריות גלובליות זמינות לכל הלקוחות. קטגוריה ייעודית מופיעה רק אצל הלקוח שלה.
            </p>
          </div>
          <Drawer triggerLabel="קטגוריה" title="קטגוריה חדשה">
            <CreateCategoryForm clients={clients.filter((c) => c.status === "ACTIVE")} />
          </Drawer>
        </div>

        <div className="overflow-hidden rounded-2xl border border-lineDark bg-white">
          <div className="flex items-center gap-3.5 border-b border-lineDark bg-cream px-[18px] py-2.5 text-[11.5px] text-appNavy/55">
            <span className="flex-1">קטגוריה</span>
            <span className="w-[120px]">היקף</span>
            <span className="w-[90px] text-end">שעות החודש</span>
            <span className="w-[80px] text-end">סטטוס</span>
          </div>
          {categories.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-appNavy/50">אין עדיין קטגוריות. הוסיפו קטגוריה ראשונה למעלה.</p>
          ) : (
            categories.map((cat, i) => (
              <a
                key={cat.id}
                href={`/app/categories/${cat.id}`}
                className="flex items-center gap-3.5 border-b border-lineDark px-[18px] py-3.5 text-[13px] text-appNavy last:border-0 hover:bg-cream/40"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span
                    className="h-[9px] w-[9px] shrink-0 rounded-[3px]"
                    style={{ backgroundColor: DOT_COLORS[i % DOT_COLORS.length] }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{cat.name}</span>
                </span>
                <span className="w-[120px] truncate text-xs text-appNavy/60">
                  {cat.visibility === "GLOBAL" ? "גלובלית" : cat.client?.name ?? "ספציפית ללקוח"}
                </span>
                <span dir="ltr" className="w-[90px] text-end font-jbmono text-appNavy">
                  {formatHM(monthlyHours.get(cat.id) ?? 0)}
                </span>
                <span className="w-[80px] text-end">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      cat.active ? "bg-success-soft text-success" : "bg-neutral-soft text-neutral"
                    }`}
                  >
                    {cat.active ? "פעילה" : "כבויה"}
                  </span>
                </span>
              </a>
            ))
          )}
        </div>
      </div>
    </>
  );
}

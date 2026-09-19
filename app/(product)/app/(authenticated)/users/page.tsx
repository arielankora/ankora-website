import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listUsers } from "@/lib/app-domain/users";
import { listClients } from "@/lib/app-domain/clients";
import { Forbidden } from "@/components/app/Forbidden";
import { Drawer } from "@/components/app/Drawer";
import { InviteUserForm } from "./InviteUserForm";
import type { UserRole, UserStatus } from "@prisma/client";

export const metadata = { robots: { index: false, follow: false } };

const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: "מנהל-על",
  ANKORA_ADMIN: "מנהל Ankora",
  ANKORA_EMPLOYEE: "עובד Ankora",
  CLIENT_USER: "לקוח",
};

const ROLE_TAG_CLASSES: Record<UserRole, string> = {
  SUPER_ADMIN: "bg-warning-soft text-warning",
  ANKORA_ADMIN: "bg-neutral-soft text-neutral",
  ANKORA_EMPLOYEE: "bg-neutral-soft text-neutral",
  CLIENT_USER: "bg-success-soft text-success",
};

const STATUS_LABEL: Record<UserStatus, string> = {
  INVITED: "ממתין",
  ACTIVE: "פעיל",
  SUSPENDED: "מושהה",
  ARCHIVED: "בארכיון",
};

const STATUS_TAG_CLASSES: Record<UserStatus, string> = {
  INVITED: "bg-warning-soft text-warning",
  ACTIVE: "bg-success-soft text-success",
  SUSPENDED: "bg-error-soft text-error",
  ARCHIVED: "bg-neutral-soft text-neutral",
};

// README screen 8's own text, verbatim (also matches the prototype's
// role-tone data) - static copy, not derived from the permissions table,
// since it's a plain-language summary for humans rather than the literal
// capability list lib/app-auth/permissions.ts enforces.
const ROLE_SCOPE_CARDS: { role: string; description: string }[] = [
  { role: "מנהל-על", description: "הכל, כולל בנקי שעות, יומן פעולות ואינטגרציות" },
  { role: "מנהל Ankora", description: "לקוחות, קטגוריות, דיווחי זמן ודוחות" },
  { role: "עובד Ankora", description: "טיימר, הזמן שלי, משימות ומועדים של לקוחותיו" },
  { role: "לקוח", description: "פורטל בלבד: בנק שעות, פילוח ודוחות שלו" },
];

function initials(name: string): string {
  return name.trim().slice(0, 2);
}

function formatLastLogin(date: Date | null): string {
  if (!date) return "מעולם לא";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(date);
}

export default async function UsersPage() {
  const user = await requireUser();

  if (!can(user.role, "user.manage")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const [users, clients] = await Promise.all([listUsers(), listClients()]);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-navy">משתמשים והרשאות</h1>
            <p className="mt-1 text-sm text-navy/60">
              {users.filter((u) => u.status === "ACTIVE").length} משתמשים פעילים · הרשאות נאכפות גם בשרת
            </p>
          </div>
          <Drawer triggerLabel="הזמנת משתמש" title="משתמש חדש">
            <InviteUserForm clients={clients.filter((c) => c.status === "ACTIVE")} />
          </Drawer>
        </div>

        <div className="overflow-hidden rounded-2xl border border-lineDark bg-white">
          <div className="flex items-center gap-3.5 border-b border-lineDark bg-paper px-[18px] py-2.5 text-[11.5px] text-navy/55">
            <span className="flex-1">משתמש</span>
            <span className="w-[120px]">תפקיד</span>
            <span className="w-[130px]">כניסה אחרונה</span>
            <span className="w-[80px]">סטטוס</span>
            <span className="w-[60px]"></span>
          </div>
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3.5 border-b border-lineDark px-[18px] py-3.5 text-[13px] last:border-0">
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-gold/16 text-[11.5px] text-gold-dim">
                  {initials(u.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-navy">{u.name}</span>
                  <span dir="ltr" className="block truncate text-end text-[11.5px] text-navy/50">
                    {u.email}
                  </span>
                </span>
              </span>
              <span className="w-[120px]">
                <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${ROLE_TAG_CLASSES[u.role]}`}>
                  {ROLE_LABEL[u.role]}
                </span>
              </span>
              <span className="w-[130px] text-xs text-navy/60">{formatLastLogin(u.lastLoginAt)}</span>
              <span className="w-[80px]">
                <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${STATUS_TAG_CLASSES[u.status]}`}>
                  {STATUS_LABEL[u.status]}
                </span>
              </span>
              <span className="w-[60px] text-end">
                <Link href={`/app/users/${u.id}`} className="text-xs text-gold-dim hover:text-gold">
                  עריכה
                </Link>
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-5">
          <p className="text-[13.5px] font-medium text-navy">מה כל תפקיד רואה</p>
          <p className="mt-1 text-xs text-navy/55">הרשאה שנשללת כאן נאכפת גם על הפעולות עצמן, לא רק על התפריט.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ROLE_SCOPE_CARDS.map((card) => (
              <div key={card.role} className="rounded-xl border border-lineDark p-3.5">
                <span className="text-[13px] font-medium text-navy">{card.role}</span>
                <p className="mt-2 text-xs leading-relaxed text-navy/60">{card.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

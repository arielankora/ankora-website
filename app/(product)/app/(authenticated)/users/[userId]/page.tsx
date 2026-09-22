import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { listClients } from "@/lib/app-domain/clients";
import { Forbidden } from "@/components/app/Forbidden";
import { EditRoleStatusForm } from "./EditRoleStatusForm";
import { ClientAccessForm } from "./ClientAccessForm";
import { ResendInviteForm } from "./ResendInviteForm";
import { logoutAllSessionsAction, revokeClaudeGrantsAction } from "../actions";
import { countClaudeGrantsForUser } from "@/lib/app-domain/mcp-connections";

export const metadata = { robots: { index: false, follow: false } };

export default async function UserDetailPage(props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const user = await requireUser();

  if (!can(user.role, "user.manage")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  // `select`, not `include`. This row is handed to EditRoleStatusForm,
  // which is a client component - so every field on it is serialised into
  // the RSC payload and shipped inside the page HTML. `include` fetches
  // the whole User, which means passwordHash: the bcrypt hash of every
  // user an admin has ever opened, sitting in page source, available to
  // any browser extension, cache or proxy in the path, and crackable
  // offline at leisure.
  //
  // Nothing rendered here ever needed it - the form reads id, role and
  // status, and nothing else. Caught by a browser test that greps the
  // served HTML for a bcrypt prefix, which is a check worth keeping for
  // exactly this reason: the leak is invisible on screen.
  const [targetUser, clients] = await Promise.all([
    prisma.user.findFirst({
      where: { id: params.userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        clientAccess: true,
      },
    }),
    listClients(),
  ]);
  if (!targetUser) notFound();

  const claudeGrantCount = await countClaudeGrantsForUser(user, targetUser.id);

  const isSelf = targetUser.id === user.id;

  return (
    <>
      <div className="space-y-6">
        <div>
          <Link href="/app/users" className="text-xs text-appNavy/50 hover:text-gold-dim">
            ← חזרה לרשימת המשתמשים
          </Link>
          <h1 className="mt-2 text-xl font-medium text-appNavy">{targetUser.name}</h1>
          <p className="mt-1 text-sm text-appNavy/60">{targetUser.email}</p>
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-appNavy">תפקיד וסטטוס</h2>
          {/* An explicit literal, not the row. The narrowed prop type on the
              component is the declaration; this is the enforcement - a prop
              typed narrower still serialises every field the object actually
              carries, because a variable is allowed to exceed its type. */}
          <EditRoleStatusForm
            targetUser={{ id: targetUser.id, role: targetUser.role, status: targetUser.status }}
            isSelf={isSelf}
          />
        </div>

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-appNavy">גישה ללקוחות</h2>
          <ClientAccessForm
            userId={targetUser.id}
            clients={clients.filter((c) => c.status === "ACTIVE").map((c) => ({ id: c.id, name: c.name }))}
            assignedClientIds={targetUser.clientAccess.map((a) => a.clientId)}
          />
        </div>

        {/* Only while the invite is still unused. 22.9.2026: before this
            existed, an expired invite could be resolved exactly one way -
            delete the person and create them again, discarding their
            client access with them. */}
        {targetUser.status === "INVITED" && (
          <div className="rounded-2xl border border-lineDark bg-white p-6">
            <h2 className="text-sm font-medium text-appNavy">הזמנה ממתינה</h2>
            <p className="mt-1 text-sm text-appNavy/60">
              המשתמש טרם בחר סיסמה. שליחה מחדש מנפיקה קישור חדש לארבעים ושמונה שעות ומבטלת את
              הקישור הקודם.
            </p>
            <ResendInviteForm userId={targetUser.id} />
          </div>
        )}

        <div className="rounded-2xl border border-lineDark bg-white p-6">
          <h2 className="text-sm font-medium text-appNavy">אבטחה</h2>
          <p className="mt-1 text-sm text-appNavy/60">
            ניתוק כל ההתחברויות הפעילות של המשתמש. שימושי אם יש חשד שהחשבון נפגע.
          </p>
          <form action={logoutAllSessionsAction} className="mt-3">
            <input type="hidden" name="userId" value={targetUser.id} />
            <button
              type="submit"
              className="rounded-full border border-lineDark px-4 py-2 text-xs font-medium text-appNavy/70 hover:border-gold hover:text-appNavy"
            >
              ניתוק כל ההתחברויות
            </button>
          </form>

          {/* Claude (MCP) access, kept as its own control rather than
              folded into the button above. "Logout all sessions" already
              revokes these grants as a side effect of bumping
              tokenVersion, but it is the blunt instrument: it also throws
              the person out of every browser tab. When someone simply no
              longer needs the integration - the common case - that is the
              wrong trade, so this cuts Claude and nothing else.

              The count is shown because an admin pressing a button that
              looks the same whether there are three grants or none is
              guessing. With none, there is nothing to press. */}
          <div className="mt-5 border-t border-lineDark pt-5">
            <p className="text-sm font-medium text-appNavy">חיבור Claude (MCP)</p>
            <p className="mt-1 text-sm text-appNavy/60">
              {claudeGrantCount > 0
                ? `למשתמש יש ${claudeGrantCount} חיבורים פעילים ל-Claude. ניתוק מבטל את כולם מיידית, בלי לנתק אותו משאר המערכת.`
                : "למשתמש אין חיבורים פעילים ל-Claude."}
            </p>
            {claudeGrantCount > 0 && (
              <form action={revokeClaudeGrantsAction} className="mt-3">
                <input type="hidden" name="userId" value={targetUser.id} />
                <button
                  type="submit"
                  className="rounded-full border border-lineDark px-4 py-2 text-xs font-medium text-appNavy/70 hover:border-error hover:text-error"
                >
                  ניתוק Claude
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

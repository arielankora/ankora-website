import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { listClients } from "@/lib/app-domain/clients";
import { Forbidden } from "@/components/app/Forbidden";
import { EditRoleStatusForm } from "./EditRoleStatusForm";
import { ClientAccessForm } from "./ClientAccessForm";
import { ExceptionApproverForm } from "./ExceptionApproverForm";
import { ResendInviteForm } from "./ResendInviteForm";
import { ExposureReport } from "./ExposureReport";
import { logoutAllSessionsAction, resetPasskeysAction, revokeClaudeGrantsAction } from "../actions";
import { countClaudeGrantsForUser } from "@/lib/app-domain/mcp-connections";
import { listAgreementsForUser } from "@/lib/app-domain/agreements";
import { AGREEMENT_CHANNEL_LABEL, AGREEMENT_KIND_LABEL } from "@/lib/agreements";
import { PersonalEmailForm } from "./PersonalEmailForm";
import { DeletionDeclarationForm } from "./DeletionDeclarationForm";

const SIGNED_AT = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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
        canApproveExceptions: true,
        personalEmail: true,
        createdAt: true,
        clientAccess: true,
      },
    }),
    listClients(),
  ]);
  if (!targetUser) notFound();

  const [claudeGrantCount, agreements, passkeyCount] = await Promise.all([
    countClaudeGrantsForUser(user, targetUser.id),
    targetUser.role === "CLIENT_USER" ? Promise.resolve([]) : listAgreementsForUser(targetUser.id),
    prisma.passkey.count({ where: { userId: targetUser.id } }),
  ]);

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

        {targetUser.role !== "CLIENT_USER" && (
          <div className="rounded-2xl border border-lineDark bg-white p-6">
            <h2 className="mb-4 text-sm font-medium text-appNavy">הרשאות מיוחדות</h2>
            <ExceptionApproverForm userId={targetUser.id} value={targetUser.canApproveExceptions} />
          </div>
        )}

        {/* Employee agreements: the private address, what this person
            has signed, and the deletion declaration for when they leave.
            Staff only; clients sign nothing here. */}
        {targetUser.role !== "CLIENT_USER" && (
          <div className="rounded-2xl border border-lineDark bg-white p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-appNavy">מסמכים חתומים</h2>
              {/* The blank forms for the PDF channel. A plain link: the
                  route answers with the file as an attachment. */}
              <span className="text-xs text-appNavy/60">
                הורדת טופס לחתימה:{" "}
                <a href="/app/agreements/blank/confidentiality" download className="text-gold-dim underline underline-offset-2 hover:text-appNavy">
                  התחייבות לסודיות
                </a>
                {" · "}
                <a href="/app/agreements/blank/deletion-declaration" download className="text-gold-dim underline underline-offset-2 hover:text-appNavy">
                  הצהרת מחיקה
                </a>
              </span>
            </div>
            <PersonalEmailForm userId={targetUser.id} value={targetUser.personalEmail} />

            <div className="mt-5 border-t border-lineDark pt-5">
              {agreements.length === 0 ? (
                <p className="text-sm text-appNavy/60">עדיין לא נחתם אף מסמך.</p>
              ) : (
                <ul className="divide-y divide-lineDark text-sm">
                  {agreements.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-appNavy">
                        {AGREEMENT_KIND_LABEL[a.kind]} <span className="text-appNavy/50">· {a.version}</span>
                      </span>
                      <span className="text-xs text-appNavy/60">
                        {AGREEMENT_CHANNEL_LABEL[a.channel]} · {SIGNED_AT.format(a.signedAt)}
                        {a.driveFileId ? (
                          <>
                            {" · "}
                            <a
                              href={`https://drive.google.com/file/d/${encodeURIComponent(a.driveFileId)}/view`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gold-dim underline underline-offset-2 hover:text-appNavy"
                            >
                              PDF
                            </a>
                          </>
                        ) : (
                          " · ללא PDF"
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 border-t border-lineDark pt-5">
              <p className="text-sm font-medium text-appNavy">הצהרת מחיקה</p>
              <p className="mt-1 text-sm text-appNavy/60">
                בסיום העבודה נשלח למייל הפרטי קישור חד-פעמי לשבעה ימים, לקריאה ולאישור של הצהרת המחיקה והחזרת הציוד.
              </p>
              <DeletionDeclarationForm
                userId={targetUser.id}
                isActive={targetUser.status === "ACTIVE" || targetUser.status === "INVITED"}
                hasPersonalEmail={!!targetUser.personalEmail}
              />
            </div>
          </div>
        )}

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

          {/* Two-step sign-in (16.10.2026). The recovery path for a lost
              device: clear the passkeys, end every session, and the person
              enrols a new one at their next sign-in, after their password. */}
          <div className="mt-5 border-t border-lineDark pt-5">
            <p className="text-sm font-medium text-appNavy">Passkeys ואימות דו-שלבי</p>
            <p className="mt-1 text-sm text-appNavy/60">
              {passkeyCount > 0
                ? `למשתמש רשומים ${passkeyCount} מכשירים. אם מכשיר אבד, איפוס מוחק את כולם ומנתק את כל ההתחברויות. בכניסה הבאה המשתמש ירשום מכשיר חדש אחרי הסיסמה.`
                : "למשתמש אין passkey רשום. בכניסה הבאה הוא יתבקש לרשום מכשיר, אם האימות הדו-שלבי חל עליו."}
            </p>
            {passkeyCount > 0 && !isSelf && (
              <form action={resetPasskeysAction} className="mt-3">
                <input type="hidden" name="userId" value={targetUser.id} />
                <button
                  type="submit"
                  className="rounded-full border border-lineDark px-4 py-2 text-xs font-medium text-appNavy/70 hover:border-error hover:text-error"
                >
                  איפוס passkeys
                </button>
              </form>
            )}
          </div>
        </div>

        {/* DPA section 4 (7.10.2026): when someone leaves, each client is
            told which of its logins that person saw, so it can change
            exactly those. Internal staff only; a client user never
            reveals anything. */}
        {targetUser.role !== "CLIENT_USER" && (
          <div className="rounded-2xl border border-lineDark bg-white p-6">
            <h2 className="text-sm font-medium text-appNavy">גישות של לקוחות שנצפו</h2>
            <p className="mt-1 text-sm text-appNavy/60">
              פרטי הגישה של לקוחות שהמשתמש צפה בהם ב-90 הימים האחרונים, לפי לקוח, עם הודעה מוכנה לכל לקוח. בעזיבת ספק פנימי,
              שולחים לכל לקוח את ההודעה שלו כדי שיחליף את הסיסמאות האלה.
            </p>
            <div className="mt-3">
              <ExposureReport userId={targetUser.id} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

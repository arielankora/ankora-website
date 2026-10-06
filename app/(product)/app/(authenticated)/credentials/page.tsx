import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listCredentials, listVaultClients } from "@/lib/app-domain/credentials";
import { isVaultConfigured } from "@/lib/vault/keys";
import { Forbidden } from "@/components/app/Forbidden";
import { Drawer } from "@/components/app/Drawer";
import { RevealCredential } from "@/components/app/vault/RevealCredential";
import { CredentialForm } from "./CredentialForm";
import { ClientPicker } from "./ClientPicker";
import { DeleteCredentialButton } from "./DeleteCredentialButton";
import { CredentialRowShell } from "./CredentialRowShell";

export const metadata = { robots: { index: false, follow: false } };

// "מערכות וגישות": a client's logins to their own systems
// (claude/credentials-vault-spec-2026-10-06.md).
//
// A standalone screen rather than a panel on the client page, because the
// client page is client.manage only and employees, who use these logins
// most, cannot open it. Scoped like every other screen an employee sees:
// the clients they are assigned to, nothing else.
//
// What reaches the browser from here: names, links, dates, yes/no flags.
// listCredentials() selects no secret column, and every row is mapped to
// an explicit plain object below before it touches a client component.

const DATE = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" });

function fmt(d: Date | null) {
  return d ? DATE.format(d) : null;
}

export default async function CredentialsPage(props: { searchParams: Promise<{ clientId?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  if (!can(user.role, "credential.view")) return <Forbidden />;

  const clients = (await listVaultClients(user)).map((c) => ({ id: c.id, name: c.name }));
  const configured = isVaultConfigured();
  const canManage = can(user.role, "credential.manage");

  if (clients.length === 0) {
    return (
      <div className="space-y-6">
        <Header />
        <p className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-appNavy/50">
          אין לקוחות שמשויכים אליך, ולכן אין גישות להצגה.
        </p>
      </div>
    );
  }

  const selected = clients.find((c) => c.id === searchParams.clientId)?.id ?? clients[0].id;
  const rows = (await listCredentials(user, selected)).map((r) => ({
    id: r.id,
    systemName: r.systemName,
    url: r.url,
    hasUsername: r.hasUsername,
    hasPassword: r.hasPassword,
    hasNotes: r.hasNotes,
    secretUpdatedAt: fmt(r.secretUpdatedAt),
    lastRevealedAt: fmt(r.lastRevealedAt),
    lastRevealedBy: r.lastRevealedBy?.name ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <Header />
        {configured && canManage && (
          <Drawer triggerLabel="גישה חדשה" title="גישה חדשה למערכת" openKey="credential">
            <CredentialForm clients={clients} clientId={selected} />
          </Drawer>
        )}
      </div>

      {!configured && (
        <p className="rounded-2xl border border-lineDark bg-cream-dim p-4 text-sm text-appNavy/70">
          הכספת עוד לא הוגדרה בסביבה הזו, ולכן אי אפשר להוסיף או להציג גישות.
        </p>
      )}

      <ClientPicker clients={clients} selected={selected} />

      <div className="space-y-3">
        {rows.length === 0 ? (
          <p className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-appNavy/50">
            עוד לא נשמרו גישות ללקוח הזה.
          </p>
        ) : (
          rows.map((row) => (
            <CredentialRowShell key={row.id} id={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-appNavy">{row.systemName}</p>
                  {row.url && (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      dir="ltr"
                      className="block truncate text-start text-xs text-gold hover:underline"
                    >
                      {row.url}
                    </a>
                  )}
                  <p className="mt-1 text-xs text-appNavy/50">
                    {[
                      [row.hasUsername && "שם משתמש", row.hasPassword && "סיסמה", row.hasNotes && "הערות"]
                        .filter(Boolean)
                        .join(", ") || "אין פרטים שמורים",
                      row.secretUpdatedAt && `עודכן ${row.secretUpdatedAt}`,
                      row.lastRevealedBy ? `נצפה לאחרונה: ${row.lastRevealedBy}, ${row.lastRevealedAt}` : "עוד לא נצפה",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {canManage && configured && (
                  <div className="flex items-center gap-3">
                    <Drawer triggerLabel="עריכה" title={`עריכת הגישה ל${row.systemName}`} variant="link">
                      <CredentialForm clients={clients} clientId={selected} existing={row} />
                    </Drawer>
                    <DeleteCredentialButton id={row.id} systemName={row.systemName} />
                  </div>
                )}
              </div>
              {configured && (row.hasUsername || row.hasPassword || row.hasNotes) && (
                <div className="mt-4">
                  <RevealCredential credentialId={row.id} />
                </div>
              )}
            </CredentialRowShell>
          ))
        )}
      </div>

      <p className="text-xs text-appNavy/50">
        שם המשתמש, הסיסמה וההערות מוצפנים. כל צפייה דורשת אימות זהות ונרשמת ביומן הפעולות.
      </p>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-xl font-medium text-appNavy">מערכות וגישות</h1>
      <p className="mt-1 text-sm text-appNavy/60">פרטי הגישה של הלקוחות למערכות שלהם, במקום אחד ומוצפן.</p>
    </div>
  );
}

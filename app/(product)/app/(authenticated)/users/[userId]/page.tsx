import { PageBack } from "@/components/app/BackSlot";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { listClients } from "@/lib/app-domain/clients";
import { Forbidden } from "@/components/app/Forbidden";
import { EditRoleStatusForm } from "./EditRoleStatusForm";
import { ClientAccessForm } from "./ClientAccessForm";
import { ExceptionApproverForm } from "./ExceptionApproverForm";
import { CommsAccessForm, type CommsLineChoice } from "./CommsAccessForm";
import { confidentialitySignedBothChannels } from "@/lib/app-domain/comms-access";
import { environmentLevelFor, lineOwnerEmails } from "@/lib/comms/grants";
import { readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { ResendInviteForm } from "./ResendInviteForm";
import { ExposureReport } from "./ExposureReport";
import { logoutAllSessionsAction, resetPasskeysAction, revokeClaudeGrantsAction } from "../actions";
import { countClaudeGrantsForUser } from "@/lib/app-domain/mcp-connections";
import { listAgreementsForUser, pendingPdfUploads } from "@/lib/app-domain/agreements";
import { CURRENT_AGREEMENTS, agreementCode } from "@/lib/agreements";
import { localDateKey } from "@/lib/timezone";
import { PendingPdfReview, type PendingPdf } from "./PendingPdfReview";
import { PersonalEmailForm } from "./PersonalEmailForm";
import { DeletionDeclarationForm } from "./DeletionDeclarationForm";

// Display only; the reader's locale and time zone (ADR 0006). The
// uploaded-on date the form starts from stays an Israel date (localDateKey).
const UPLOADED_ON = { day: "numeric", month: "numeric" } as const;

const SIGNED_AT = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
} as const;

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
        commsAccessLevel: true,
        personalEmail: true,
        createdAt: true,
        clientAccess: true,
      },
    }),
    listClients(),
  ]);
  if (!targetUser) notFound();

  const t = await getTranslations("users.detail");
  const format = await getFormatter();

  const isStaff = targetUser.role !== "CLIENT_USER";
  const [claudeGrantCount, agreements, passkeyCount, pending] = await Promise.all([
    countClaudeGrantsForUser(user, targetUser.id),
    isStaff ? listAgreementsForUser(targetUser.id) : Promise.resolve([]),
    prisma.passkey.count({ where: { userId: targetUser.id } }),
    isStaff ? pendingPdfUploads(targetUser.id) : Promise.resolve(null),
  ]);

  // Signed PDFs the person uploaded and nobody has checked yet: the reason
  // the approvals screen links here. Shown first, with the file to open.
  const pendingIds = pending ? Object.values(pending).flat().map((p) => p.documentId) : [];
  const pendingDocs = pendingIds.length
    ? await prisma.clientDocument.findMany({ where: { id: { in: pendingIds } }, select: { id: true, driveFileId: true } })
    : [];
  const pendingItems: PendingPdf[] = pending
    ? (Object.keys(pending) as (keyof typeof pending)[]).flatMap((kind) =>
        pending[kind].map((p) => {
          const driveFileId = pendingDocs.find((d) => d.id === p.documentId)?.driveFileId;
          return {
            documentId: p.documentId,
            kindLabel: t(`agreementKind.${kind}`),
            code: agreementCode(kind, CURRENT_AGREEMENTS[kind]),
            uploadedOn: localDateKey(p.uploadedAt),
            uploadedLabel: format.dateTime(p.uploadedAt, UPLOADED_ON),
            fileUrl: driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view` : null,
          };
        })
      )
    : [];

  const isSelf = targetUser.id === user.id;

  // The communications screen (12.11.2026): the level, the lines, and what
  // the environment already gives this person.
  let commsLines: CommsLineChoice[] = [];
  let confidentialitySigned = false;
  if (isStaff) {
    const [owners, signed] = await Promise.all([lineOwnerEmails(), confidentialitySignedBothChannels(targetUser.id)]);
    confidentialitySigned = signed;
    const me = targetUser.email.trim().toLowerCase();
    const otherEmails = [...new Set([...owners.values()].filter((e) => e !== me))];
    const others = otherEmails.length
      ? await prisma.user.findMany({ where: { email: { in: otherEmails } }, select: { email: true, name: true } })
      : [];
    const nameOf = new Map(others.map((o) => [o.email.toLowerCase(), o.name]));
    commsLines = readPocConfig().lineNumbers.map((line) => {
      const owner = owners.get(line) ?? null;
      return { line, mine: owner === me, otherOwner: owner && owner !== me ? (nameOf.get(owner) ?? owner) : null };
    });
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <PageBack href="/app/users" label={t("back")} />
          <h1 dir="auto" className="mt-3 text-xl font-medium text-app-text-primary">{targetUser.name}</h1>
          <p className="mt-1 text-sm text-app-text-secondary">{targetUser.email}</p>
        </div>

        {pendingItems.length > 0 && <PendingPdfReview userId={targetUser.id} userName={targetUser.name} items={pendingItems} />}

        <div className="rounded-2xl border border-app-border bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-app-text-primary">{t("roleStatusTitle")}</h2>
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
          <div className="rounded-2xl border border-app-border bg-white p-6">
            <h2 className="mb-4 text-sm font-medium text-app-text-primary">{t("specialPermissionsTitle")}</h2>
            <ExceptionApproverForm userId={targetUser.id} value={targetUser.canApproveExceptions} />
            <div className="mt-6 border-t border-app-border pt-6">
              <CommsAccessForm
                userId={targetUser.id}
                level={targetUser.commsAccessLevel}
                environmentLevel={environmentLevelFor(targetUser.email)}
                confidentialitySigned={confidentialitySigned}
                lines={commsLines}
              />
            </div>
          </div>
        )}

        {/* Employee agreements: the private address, what this person
            has signed, and the deletion declaration for when they leave.
            Staff only; clients sign nothing here. */}
        {targetUser.role !== "CLIENT_USER" && (
          <div className="rounded-2xl border border-app-border bg-white p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-app-text-primary">{t("signedDocsTitle")}</h2>
              {/* The blank forms for the PDF channel. A plain link: the
                  route answers with the file as an attachment. */}
              <span className="text-xs text-app-text-secondary">
                {t("blankForms")}{" "}
                <a href="/app/agreements/blank/confidentiality" download className="text-app-text-accent underline underline-offset-2 hover:text-app-text-primary">
                  {t("agreementKind.CONFIDENTIALITY")}
                </a>
                {" · "}
                <a href="/app/agreements/blank/deletion-declaration" download className="text-app-text-accent underline underline-offset-2 hover:text-app-text-primary">
                  {t("agreementKind.DELETION_DECLARATION")}
                </a>
              </span>
            </div>
            <PersonalEmailForm userId={targetUser.id} value={targetUser.personalEmail} />

            <div className="mt-5 border-t border-app-border pt-5">
              {agreements.length === 0 ? (
                <p className="text-sm text-app-text-secondary">{t("noSignedDocs")}</p>
              ) : (
                <ul className="divide-y divide-app-border text-sm">
                  {agreements.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-app-text-primary">
                        {t(`agreementKind.${a.kind}`)}{" "}
                        <span className="text-app-text-tertiary">
                          · <bdi>{a.version}</bdi>
                        </span>
                      </span>
                      <span className="text-xs text-app-text-secondary">
                        {t(`agreementChannel.${a.channel}`)} · {format.dateTime(a.signedAt, SIGNED_AT)}
                        {a.driveFileId ? (
                          <>
                            {" · "}
                            <a
                              href={`https://drive.google.com/file/d/${encodeURIComponent(a.driveFileId)}/view`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-app-text-accent underline underline-offset-2 hover:text-app-text-primary"
                            >
                              PDF
                            </a>
                          </>
                        ) : (
                          ` · ${t("noPdf")}`
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 border-t border-app-border pt-5">
              <p className="text-sm font-medium text-app-text-primary">{t("agreementKind.DELETION_DECLARATION")}</p>
              <p className="mt-1 text-sm text-app-text-secondary">
                {t("deletionIntro")}
              </p>
              <DeletionDeclarationForm
                userId={targetUser.id}
                isActive={targetUser.status === "ACTIVE" || targetUser.status === "INVITED"}
                hasPersonalEmail={!!targetUser.personalEmail}
              />
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-app-border bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-app-text-primary">{t("clientAccessTitle")}</h2>
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
          <div className="rounded-2xl border border-app-border bg-white p-6">
            <h2 className="text-sm font-medium text-app-text-primary">{t("pendingInviteTitle")}</h2>
            <p className="mt-1 text-sm text-app-text-secondary">
              {t("pendingInviteIntro")}
            </p>
            <ResendInviteForm userId={targetUser.id} />
          </div>
        )}

        <div className="rounded-2xl border border-app-border bg-white p-6">
          <h2 className="text-sm font-medium text-app-text-primary">{t("securityTitle")}</h2>
          <p className="mt-1 text-sm text-app-text-secondary">
            {t("logoutAllIntro")}
          </p>
          <form action={logoutAllSessionsAction} className="mt-3">
            <input type="hidden" name="userId" value={targetUser.id} />
            <button
              type="submit"
              className="rounded-full border border-app-border px-4 py-2 text-xs font-medium text-app-text-secondary hover:border-gold hover:text-app-text-primary"
            >
              {t("logoutAll")}
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
          <div className="mt-5 border-t border-app-border pt-5">
            <p className="text-sm font-medium text-app-text-primary">{t("claudeTitle")}</p>
            <p className="mt-1 text-sm text-app-text-secondary">
              {claudeGrantCount > 0 ? t("claudeActive", { count: claudeGrantCount }) : t("claudeNone")}
            </p>
            {claudeGrantCount > 0 && (
              <form action={revokeClaudeGrantsAction} className="mt-3">
                <input type="hidden" name="userId" value={targetUser.id} />
                <button
                  type="submit"
                  className="rounded-full border border-app-border px-4 py-2 text-xs font-medium text-app-text-secondary hover:border-app-error hover:text-app-error"
                >
                  {t("claudeRevoke")}
                </button>
              </form>
            )}
          </div>

          {/* Two-step sign-in (16.10.2026). The recovery path for a lost
              device: clear the passkeys, end every session, and the person
              enrols a new one at their next sign-in, after their password. */}
          <div className="mt-5 border-t border-app-border pt-5">
            <p className="text-sm font-medium text-app-text-primary">{t("passkeysTitle")}</p>
            <p className="mt-1 text-sm text-app-text-secondary">
              {passkeyCount > 0 ? t("passkeysSome", { count: passkeyCount }) : t("passkeysNone")}
            </p>
            {passkeyCount > 0 && !isSelf && (
              <form action={resetPasskeysAction} className="mt-3">
                <input type="hidden" name="userId" value={targetUser.id} />
                <button
                  type="submit"
                  className="rounded-full border border-app-border px-4 py-2 text-xs font-medium text-app-text-secondary hover:border-app-error hover:text-app-error"
                >
                  {t("passkeysReset")}
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
          <div className="rounded-2xl border border-app-border bg-white p-6">
            <h2 className="text-sm font-medium text-app-text-primary">{t("exposureTitle")}</h2>
            <p className="mt-1 text-sm text-app-text-secondary">
              {t("exposureIntro")}
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

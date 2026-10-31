import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { Forbidden } from "@/components/app/Forbidden";
import { canViewWhatsappPoc } from "@/lib/whatsapp-poc/access";
import { matchPhones } from "@/lib/whatsapp-poc/clients-by-phone";
import { callSide, listRecordings, type Recording } from "@/lib/whatsapp-poc/recordings";
import { UnipileError, readPocConfig } from "@/lib/whatsapp-poc/unipile";
import { RecordingPlayer } from "./RecordingPlayer";
import { TranscribeButton } from "./TranscribeButton";

// WhatsApp POC, stage 2 (1.11.2026): the Aloha line's call recordings,
// read live from the aloha@ mailbox, each with a player, the client the
// other number belongs to (from the client files), and on-demand
// transcription. See lib/whatsapp-poc/recordings.ts.

export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(
    new Date(iso),
  );
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const DIRECTION_LABEL = { in: "נכנסת", out: "יוצאת", unknown: "" } as const;

export default async function WhatsappPocCallsPage() {
  const user = await requireUser();
  const config = readPocConfig();
  if (!canViewWhatsappPoc(user, config.viewers)) return <Forbidden />;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">הקלטות שיחה: בדיקה</h1>
        <p className="mt-1 text-sm text-app-text-secondary">
          נקרא בזמן אמת מהתיבה aloha@ דרך Unipile ולא נשמר במערכת. תמלול רק בלחיצה.
        </p>
      </div>
      <Link href="/app/whatsapp-poc" className="inline-flex min-h-11 items-center text-sm text-app-text-primary underline">
        ל-WhatsApp
      </Link>
    </div>
  );

  if (!config.apiKey || !config.mailAccountId) {
    return (
      <div className="space-y-4">
        {header}
        <p className="text-sm text-app-text-secondary">ההקלטות לא מוגדרות בסביבה הזו. חסר ALOHA_UNIPILE_ACCOUNT_ID.</p>
      </div>
    );
  }

  let recordings: Recording[] = [];
  let loadError: string | null = null;
  try {
    recordings = await listRecordings({ apiKey: config.apiKey, mailAccountId: config.mailAccountId });
  } catch (err) {
    if (!(err instanceof UnipileError)) throw err;
    loadError = err.message;
  }
  const sides = recordings.map((r) => callSide(r, config.lineNumber));
  const matches = await matchPhones(sides.map((s) => s.other));

  return (
    <div className="space-y-4">
      {header}
      {!config.hasOpenAiKey ? (
        <p className="rounded-lg bg-app-surface-sunken p-3 text-sm text-app-text-secondary">
          התמלול עוד לא מוגדר (חסר OPENAI_API_KEY). ההאזנה עובדת.
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" className="rounded-lg bg-app-error-soft p-3 text-sm text-app-error">
          {loadError}
        </p>
      ) : null}

      <ul className="space-y-3">
        {recordings.map((r, i) => {
          const side = sides[i];
          const match = matches.get(side.other);
          return (
            <li key={r.emailId} className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-app-text-primary">
                  {DIRECTION_LABEL[side.direction] ? `${DIRECTION_LABEL[side.direction]} · ` : ""}
                  {match?.personName ?? "לא מזוהה"}
                  {match && match.clients.length > 0 ? (
                    <>
                      {" · "}
                      {match.clients.map((c, j) => (
                        <span key={c.id}>
                          {j > 0 ? ", " : ""}
                          <Link href={`/app/clients/${c.id}`} className="underline">
                            {c.name}
                          </Link>
                        </span>
                      ))}
                    </>
                  ) : null}
                </p>
                <p className="text-xs text-app-text-secondary">
                  {formatDateTime(r.callAt)} {formatSize(r.sizeBytes) ? `· ${formatSize(r.sizeBytes)}` : ""}
                </p>
              </div>
              <p dir="ltr" className="text-end text-xs text-app-text-secondary">
                {side.direction === "unknown" ? `${r.from} → ${r.to}` : side.other}
              </p>
              <RecordingPlayer src={`/api/whatsapp-poc/recordings/${encodeURIComponent(r.emailId)}`} />
              {config.hasOpenAiKey ? <TranscribeButton kind="recording" emailId={r.emailId} /> : null}
            </li>
          );
        })}
        {recordings.length === 0 && !loadError ? (
          <li className="text-sm text-app-text-secondary">אין הקלטות.</li>
        ) : null}
      </ul>
    </div>
  );
}

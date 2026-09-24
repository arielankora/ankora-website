"use client";
import { useRef, useState } from "react";
import { MessageSquare, Paperclip, Trash2, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { renderMarkdownLite } from "@/lib/markdown-lite";
import { addTaskCommentAction, attachFileToTaskAction, deleteTaskCommentAction } from "./actions";

// Tasks phase 3: the thread.
//
// One list, three kinds of line, and it replaces the read-only history
// panel rather than sitting beside it. A screen with "history" in one box
// and "comments" in another asks the reader to interleave two timelines
// in their head, which is exactly the work the merge is for: a status
// change and the sentence explaining it belong next to each other,
// because one is usually the answer to the other.
//
// The composer is at the top, above the newest entry. That follows the
// list's order rather than a chat's: the question somebody opens a task
// with is "where is this now", and an inverted list would make them
// scroll to find out.
//
// Nothing here writes HTML. Comment bodies are Markdown as plain text,
// rendered by lib/markdown-lite.ts, which escapes the whole input before
// it applies a single pattern. Read that file's security note before
// changing either side of this.

export type ThreadEntry =
  | { kind: "event"; id: string; at: string; actorName: string | null; label: string; changed: string[] }
  | { kind: "comment"; id: string; at: string; actorName: string | null; body: string; canDelete: boolean }
  | {
      kind: "file";
      id: string;
      at: string;
      actorName: string | null;
      title: string;
      mimeType: string;
      sizeBytes: number | null;
      clientVisible: boolean;
    };

export function TaskThread({
  taskId,
  entries,
  commentCount,
  storageReady,
  maxBytes,
}: {
  taskId: string;
  entries: ThreadEntry[];
  commentCount: number;
  /// False until the Drive folder is configured. The composer still
  /// works; only the paperclip says why it cannot.
  storageReady: boolean;
  maxBytes: number;
}) {
  const { showToast } = useToast();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function post() {
    const text = body.trim();
    if (!text || pending) return;
    setPending(true);
    const result = await addTaskCommentAction({ taskId, body: text });
    setPending(false);
    if (!result.ok) {
      showToast({ tone: "error", title: "ההערה לא נשמרה", description: result.error });
      return;
    }
    // Cleared only once the server has taken it. A textarea emptied
    // optimistically is a paragraph somebody has to write again.
    setBody("");
    showToast({ tone: "success", title: "ההערה נוספה" });
  }

  async function attach(file: File) {
    if (file.size > maxBytes) {
      showToast({
        tone: "error",
        title: "הקובץ גדול מדי",
        description: `עד ${Math.round(maxBytes / (1024 * 1024))}MB. אפשר לדחוס או לסרוק באיכות נמוכה יותר.`,
      });
      return;
    }
    setPending(true);
    const form = new FormData();
    form.set("taskId", taskId);
    form.set("file", file);
    const result = await attachFileToTaskAction(form);
    setPending(false);
    if (!result.ok) {
      showToast({ tone: "error", title: "הקובץ לא צורף", description: result.error });
      return;
    }
    showToast({ tone: "success", title: "הקובץ צורף", description: file.name });
  }

  async function remove(id: string) {
    setPending(true);
    const result = await deleteTaskCommentAction({ commentId: id });
    setPending(false);
    if (!result.ok) {
      showToast({ tone: "error", title: "המחיקה נכשלה", description: result.error });
      return;
    }
    showToast({ tone: "success", title: "ההערה נמחקה" });
  }

  return (
    <section className="rounded-2xl border border-lineDark bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-appNavy/70">
        <MessageSquare size={15} strokeWidth={1.75} className="text-appNavy/40" />
        שרשור
      </h2>

      <div className="mt-4">
        <textarea
          rows={3}
          value={body}
          disabled={pending}
          aria-label="הערה חדשה"
          onChange={(e) => setBody(e.target.value)}
          placeholder="מה קרה, מה נוסה, מה ענו. מה שהיה הולך לוואטסאפ."
          className="w-full rounded-lg border border-lineDark px-3 py-2 text-[14px] leading-relaxed text-appNavy outline-none focus:border-appNavy/40"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || !body.trim()}
            onClick={post}
            className="rounded-full bg-appNavy px-4 py-1.5 text-[13px] font-medium text-cream disabled:opacity-40"
          >
            הוספת הערה
          </button>

          <input
            ref={fileInput}
            type="file"
            className="hidden"
            aria-label="צירוף קובץ"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset first: picking the same file twice in a row fires
              // no change event otherwise, and the second attempt looks
              // like a dead button.
              e.target.value = "";
              if (file) void attach(file);
            }}
          />
          <button
            type="button"
            disabled={pending || !storageReady}
            title={storageReady ? undefined : "אחסון הקבצים עדיין לא חובר."}
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-full border border-lineDark px-4 py-1.5 text-[13px] text-appNavy/70 hover:text-appNavy disabled:opacity-40"
          >
            <Paperclip size={14} />
            צירוף קובץ
          </button>

          <span className="text-[12px] text-appNavy/45">
            אפשר **מודגש**, *נטוי*, `קוד`, רשימות וקישורים.
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="mt-5 text-sm text-appNavy/45">אין עדיין כלום בשרשור.</p>
      ) : (
        <ol className="mt-5 space-y-3.5">
          {entries.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`} className="flex gap-3">
              <Dot kind={entry.kind} />
              <div className="min-w-0 flex-1">
                {entry.kind === "comment" ? (
                  <Comment entry={entry} pending={pending} onRemove={() => remove(entry.id)} />
                ) : entry.kind === "file" ? (
                  <FileLine entry={entry} />
                ) : (
                  <p className="text-[13.5px] text-appNavy">
                    {entry.label}
                    {entry.changed.length > 0 && (
                      <span className="text-appNavy/55">: {entry.changed.join(", ")}</span>
                    )}
                  </p>
                )}
                <p className="mt-0.5 text-[12px] text-appNavy/45">
                  {/* Nullable on purpose: a task opened by the nightly
                      important-dates job has no person behind it, and
                      saying "המערכת" is more honest than a blank. */}
                  {entry.actorName ?? "המערכת"} · {formatWhen(entry.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {commentCount === 0 && entries.length > 0 && (
        <p className="mt-4 text-[12.5px] text-appNavy/45">
          עדיין לא כתב כאן אף אחד. מה שכתוב למעלה זה מה שהמערכת תיעדה.
        </p>
      )}
    </section>
  );
}

/// A comment carries a person's words, so it gets a card. Events and
/// files are one line each, because they are facts and not writing.
function Comment({
  entry,
  pending,
  onRemove,
}: {
  entry: Extract<ThreadEntry, { kind: "comment" }>;
  pending: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-lineDark bg-cream-dim/40 px-3.5 py-2.5">
      <div
        className="space-y-2 text-[14px] leading-relaxed text-appNavy/90 [&_p]:m-0"
        dangerouslySetInnerHTML={{ __html: renderMarkdownLite(entry.body) }}
      />
      {entry.canDelete && (
        <button
          type="button"
          disabled={pending}
          onClick={onRemove}
          // Named in full rather than as an icon alone: a bare bin next
          // to somebody's words is the control people click by accident.
          aria-label="מחיקת ההערה"
          className="mt-2 inline-flex items-center gap-1 text-[12px] text-appNavy/45 hover:text-error disabled:opacity-40"
        >
          <Trash2 size={12} />
          מחיקה
        </button>
      )}
    </div>
  );
}

function FileLine({ entry }: { entry: Extract<ThreadEntry, { kind: "file" }> }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-appNavy">
      <Paperclip size={13} className="text-appNavy/40" />
      {entry.title}
      {entry.sizeBytes !== null && (
        <span className="text-appNavy/45">({formatSize(entry.sizeBytes)})</span>
      )}
      {/* Said on the line, because filing a document against a promise
          is a choice about what the client gets to see, and the next
          person should not have to go looking for it. */}
      <span className="inline-flex items-center gap-1 text-[12px] text-appNavy/45">
        {entry.clientVisible ? <Eye size={12} /> : <EyeOff size={12} />}
        {entry.clientVisible ? "הלקוח רואה" : "פנימי"}
      </span>
    </p>
  );
}

function Dot({ kind }: { kind: ThreadEntry["kind"] }) {
  // A comment's mark is filled, the rest are not. The thread is mostly
  // machine-written lines, and the eye should find the human ones.
  const filled = kind === "comment";
  return (
    <span
      className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${filled ? "bg-appNavy/70" : "bg-appNavy/25"}`}
    />
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(iso));
}

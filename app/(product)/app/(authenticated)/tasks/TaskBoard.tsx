"use client";
import Link from "next/link";
import { Hourglass } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { toggleTaskDoneAction } from "./actions";
import { waitingTitle } from "@/lib/app-domain/portal-labels";
import type { TaskBlocker, TaskPriority, TaskStatus } from "@prisma/client";

// Tasks phase 4, the board.
//
// The reason this came second and not first: a board answers "how is the
// work distributed" and a search box answers "where is that one task",
// and the second question is asked twenty times a day. With search in
// place the board is worth building, and it inherits every filter from
// it - a board of one client, or of one person's work, is the view that
// makes a column count mean something.
//
// **The board changes nothing about the rules.** Dropping a card calls
// the same Server Action the list's checkbox calls, which calls the same
// `updateTask`, which still refuses to close a supervised task that was
// never sent for approval and still refuses to close a promise with no
// sentence for the client. A board that could bypass those would be a
// second way to write to a task, and that is how a rule stops applying.
//
// Two of those refusals are worth catching before they happen rather
// than reporting after, and the difference between them is the point:
//   - No outcome sentence: the person CAN fix it right here, so the
//     toast asks for the line and then completes the move. Same pattern
//     the timer uses when a promise closes.
//   - Approval required: the person may not be allowed to fix it at all,
//     so the server answers and the card goes back.

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "OPEN", label: "פתוחות" },
  { status: "IN_PROGRESS", label: "בביצוע" },
  { status: "PENDING_APPROVAL", label: "ממתינות לאישור" },
  { status: "DONE", label: "הושלמו" },
];

// ARCHIVED has no column, matching the status pills on the list. Archived
// work is not a stage of anything; it is work somebody decided to stop
// looking at, and a column for it would put a permanent graveyard beside
// four live ones.

const PRIORITY_DOT: Record<TaskPriority, string> = {
  LOW: "bg-transparent",
  NORMAL: "bg-transparent",
  HIGH: "bg-warning",
  URGENT: "bg-error",
};

/// How many cards a column draws before it stops.
///
/// The query behind this screen is already scoped to one person's
/// clients and to whatever they filtered by, so this is a guard against
/// a pathological column rather than a paging feature: "הושלמו" on an
/// unfiltered board is every task ever finished, and a thousand cards in
/// one column is a slow page that tells nobody anything.
const COLUMN_CAP = 50;

export type BoardCard = {
  id: string;
  title: string;
  clientName: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assignedToName: string | null;
  clientVisible: boolean;
  hasOutcome: boolean;
  /// Tasks phase 5. Null means nothing is holding this card up.
  blockedOn: TaskBlocker | null;
  blockedSince: string | null;
};

export function TaskBoard({ cards }: { cards: BoardCard[] }) {
  const { showToast } = useToast();
  const [local, setLocal] = useState(cards);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [pending, setPending] = useState(false);

  // Re-seed from the server whenever what it sent actually changed. Keyed
  // on the ids and statuses rather than on the array's identity: the
  // array is new on every render of the page above, and resetting local
  // state on each of those would throw away an in-flight optimistic move.
  const signature = useMemo(() => cards.map((c) => `${c.id}:${c.status}`).join(","), [cards]);
  useEffect(() => {
    setLocal(cards);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  async function move(card: BoardCard, to: TaskStatus, outcome?: string) {
    const from = card.status;
    if (from === to) return;

    // Optimistic, and reverted in full on a refusal. Anything less makes
    // a card that snaps back look like a bug rather than an answer.
    setLocal((prev) => prev.map((c) => (c.id === card.id ? { ...c, status: to } : c)));
    setPending(true);
    const result = await toggleTaskDoneAction({
      taskId: card.id,
      nextStatus: to,
      ...(outcome ? { clientOutcome: outcome } : {}),
    });
    setPending(false);

    if (!result.ok) {
      setLocal((prev) => prev.map((c) => (c.id === card.id ? { ...c, status: from } : c)));
      showToast({ tone: "error", title: "המשימה לא הוזזה", description: result.error });
      return;
    }
    showToast({
      tone: "success",
      title: `${card.title}: ${COLUMNS.find((c) => c.status === to)?.label ?? ""}`,
    });
  }

  function drop(to: TaskStatus, id: string) {
    const card = local.find((c) => c.id === id);
    if (!card || card.status === to) return;

    // The one refusal worth asking about instead of reporting. A promise
    // the client can see does not close without a sentence saying what
    // came of it, and the person dragging the card is exactly the person
    // who knows what to write.
    if (to === "DONE" && card.clientVisible && !card.hasOutcome) {
      showToast({
        tone: "warning",
        title: "לפני הסגירה",
        description: card.title,
        ask: {
          question: "מה נגיד ללקוח שקרה?",
          choices: [
            {
              value: "close",
              label: "סיום",
              prompt: { label: "במשפט אחד, בשפה של הלקוח", placeholder: "משפט אחד, בשפה שלו" },
            },
            { value: "cancel", label: "ביטול" },
          ],
          onAnswer: async (value, text) => {
            if (value !== "close" || !text) return;
            await move(card, to, text);
          },
        },
      });
      return;
    }
    void move(card, to);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((column) => {
        const rows = local.filter((c) => c.status === column.status);
        const shown = rows.slice(0, COLUMN_CAP);
        return (
          <section
            key={column.status}
            onDragOver={(e) => {
              // Without preventDefault the browser refuses the drop and
              // the card silently springs back, which reads as a broken
              // board rather than as a rejected move.
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(column.status);
            }}
            onDragLeave={() => setOver((s) => (s === column.status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              drop(column.status, e.dataTransfer.getData("text/plain"));
            }}
            data-column={column.status}
            className={`flex w-[264px] shrink-0 flex-col rounded-2xl border p-2.5 transition-colors ${
              over === column.status ? "border-appNavy bg-appNavy/[0.04]" : "border-lineDark bg-cream-dim/30"
            }`}
          >
            <h2 className="flex items-baseline gap-2 px-1.5 pb-2 text-[13px] font-medium text-appNavy">
              {column.label}
              <span className="font-jbmono text-[11px] text-appNavy/45">{rows.length}</span>
            </h2>

            <div className="flex flex-col gap-2">
              {shown.map((card) => (
                <Card key={card.id} card={card} disabled={pending} />
              ))}
              {rows.length > shown.length && (
                <p className="px-1.5 py-1 text-[12px] text-appNavy/45">
                  ועוד {rows.length - shown.length}. אפשר לצמצם עם החיפוש או עם מסנן הלקוח.
                </p>
              )}
              {rows.length === 0 && (
                <p className="px-1.5 py-3 text-[12px] text-appNavy/35">ריק</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Card({ card, disabled }: { card: BoardCard; disabled: boolean }) {
  const overdue =
    card.dueDate !== null && card.status !== "DONE" && new Date(card.dueDate).getTime() < Date.now();

  return (
    <article
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      data-task-card={card.id}
      className="cursor-grab rounded-xl border border-lineDark bg-white p-3 active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        {/* Only where it means something: NORMAL is most cards, and a dot
            on every one of them is a dot that says nothing. */}
        <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[card.priority]}`} />
        <Link
          href={`/app/tasks/${card.id}`}
          // Dragging a link is the browser's own gesture and it wins over
          // ours, so the link does not carry the drag: the card does.
          draggable={false}
          className="min-w-0 flex-1 text-[13.5px] leading-snug text-appNavy hover:text-appNavy/70"
        >
          {card.title}
        </Link>
      </div>

      <p className="mt-1.5 truncate text-[12px] text-appNavy/50">{card.clientName}</p>

      {/* A line on the card, not a fifth column. A blocked task has not
          left the stage it is in - somebody is still on it, they are
          just waiting - and a column called "חסום" is where cards go to
          be forgotten. See the schema comment on Task.blockedOn. */}
      {card.blockedOn && (
        <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-warning">
          <Hourglass size={12} strokeWidth={1.8} />
          {waitingTitle(card.blockedOn, card.blockedSince)}
        </p>
      )}

      {(card.assignedToName || card.dueDate) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px]">
          {card.assignedToName && <span className="text-appNavy/55">{card.assignedToName}</span>}
          {card.dueDate && (
            <span className={overdue ? "font-medium text-error" : "text-appNavy/45"}>
              {formatDue(card.dueDate)}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function formatDue(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(iso));
}

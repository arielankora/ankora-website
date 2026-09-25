"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useActionForm } from "@/components/app/useActionForm";
import { addTaskStepAction, applyTaskTemplateAction, setTaskStepDoneAction } from "./actions";
import type { TaskStatus } from "@prisma/client";

// Tasks phase 5: the steps of a task.
//
// One level, and the reason is the shape of the work rather than a
// limitation. Tasks here live for days, not quarters. What a person
// needs is not a project tree, it is the four things they have to
// remember about this one task, in the order they thought of them.
//
// So it reads as a checklist and behaves as one. What makes it more
// than a checklist is that each line IS a task: it can carry its own
// assignee, its own deadline and its own timer, and it opens on its own
// screen when it needs to. Nobody has to learn a second concept for
// "a thing that has to happen".
//
// **Adding one asks for a title and nothing else.** The drawer that
// creates a full task asks for seven fields, and that is right for a
// task somebody is committing to. A step is a thought at the moment of
// having it, and a form is how a thought gets lost. Everything else
// about a step is editable afterwards, on the step's own screen.

export type Step = {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  assignedToName: string | null;
};

const OPEN: TaskStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL"];

export type TemplateChoice = { id: string; name: string; when: string; stepCount: number };

export function TaskSteps({
  taskId,
  clientId,
  steps,
  parentIsClosed,
  templates,
}: {
  taskId: string;
  clientId: string;
  steps: Step[];
  parentIsClosed: boolean;
  templates: TemplateChoice[];
}) {
  const done = steps.filter((s) => !OPEN.includes(s.status)).length;

  return (
    <div className="rounded-2xl border border-lineDark bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium text-appNavy/70">שלבים</h2>
        {steps.length > 0 && (
          <span className="font-jbmono text-[13px] text-appNavy/55">
            {done}/{steps.length}
          </span>
        )}
      </div>

      {steps.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] text-appNavy/55">
          אפשר לפרק את המשימה לשלבים. לכל שלב אפשר לתת אחראי, תאריך יעד וטיימר משלו.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-lineDark/70">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} parentId={taskId} />
          ))}
        </ul>
      )}

      {/* A task that is finished does not grow new steps. The server
          refuses it either way (PARENT_CLOSED_MESSAGE); hiding the field
          means nobody types a sentence only to be told no. */}
      {!parentIsClosed && (
        <>
          <AddStep taskId={taskId} clientId={clientId} />
          <FromTheBook taskId={taskId} templates={templates} />
        </>
      )}
    </div>
  );
}

function StepRow({ step, parentId }: { step: Step; parentId: string }) {
  const isDone = !OPEN.includes(step.status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await setTaskStepDoneAction({ stepId: step.id, parentId, done: !isDone });
    if (!result.ok) setError(result.error);
    setPending(false);
  }

  return (
    <li className="flex items-start gap-2.5 py-2.5">
      <input
        type="checkbox"
        checked={isDone}
        disabled={pending}
        onChange={toggle}
        // The step's own title, so a screen reader announcing a column of
        // checkboxes says what each one closes rather than "checkbox,
        // checkbox, checkbox".
        aria-label={`סימון השלב ${step.title} כהושלם`}
        className="mt-[3px] h-4 w-4 shrink-0 cursor-pointer accent-appNavy"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={`/app/tasks/${step.id}`}
          className={`block text-[13.5px] transition-colors hover:text-appNavy ${
            isDone ? "text-appNavy/45 line-through" : "text-appNavy"
          }`}
        >
          {step.title}
        </Link>
        {(step.assignedToName || step.dueDate) && (
          <p className="mt-0.5 text-[11.5px] text-appNavy/50">
            {[step.assignedToName, step.dueDate ? formatDay(step.dueDate) : null].filter(Boolean).join(" · ")}
          </p>
        )}
        {error && <p className="mt-1 text-[11.5px] text-error">{error}</p>}
      </div>
    </li>
  );
}

function AddStep({ taskId, clientId }: { taskId: string; clientId: string }) {
  const [title, setTitle] = useState("");
  const { onSubmit, pending, error } = useActionForm(
    (_prev, data: FormData) =>
      addTaskStepAction({ taskId, clientId, title: String(data.get("title") ?? "") }),
    () => setTitle("")
  );

  return (
    <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2">
      <Plus size={15} className="shrink-0 text-appNavy/40" />
      <input
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="שלב חדש"
        placeholder="מה צריך לקרות"
        className="min-w-0 flex-1 border-b border-lineDark bg-transparent py-1.5 text-[13.5px] text-appNavy outline-none placeholder:text-appNavy/35 focus:border-appNavy"
      />
      <button
        type="submit"
        disabled={pending || !title.trim()}
        className="shrink-0 rounded-full border border-lineDark px-3 py-1.5 text-[12.5px] font-medium text-appNavy transition-colors hover:border-gold disabled:opacity-40"
      >
        {pending ? "מוסיף..." : "הוספה"}
      </button>
      {error && <p className="w-full text-[11.5px] text-error">{error}</p>}
    </form>
  );
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

/// The procedures from the SOP book, one click away.
///
/// Closed by default and opened by a link rather than sitting open as a
/// row of buttons. Most tasks are not one of these seven situations, and
/// a permanent row of seven names on every task screen would be seven
/// things to read past on the way to the thing somebody came for.
///
/// Each one says WHEN to reach for it, not what is in it. A person
/// choosing between "טעות שהתגלתה" and "משבר" is asking which situation
/// they are in, and the step list will answer the other question a
/// second later.
function FromTheBook({ taskId, templates }: { taskId: string; templates: TemplateChoice[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(templateId: string) {
    if (busy) return;
    setBusy(templateId);
    setError(null);
    const result = await applyTaskTemplateAction({ taskId, templateId });
    if (!result.ok) setError(result.error);
    else setOpen(false);
    setBusy(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-[12.5px] text-gold-dim transition-colors hover:text-appNavy"
      >
        מתוך ספר הנהלים
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-lineDark bg-cream/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12.5px] font-medium text-appNavy">מתוך ספר הנהלים</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11.5px] text-appNavy/50 hover:text-appNavy"
        >
          סגירה
        </button>
      </div>
      <p className="mt-0.5 text-[11.5px] text-appNavy/55">
        השלבים נוספים למה שכבר יש כאן, ולא במקומו.
      </p>
      <ul className="mt-2 space-y-1">
        {templates.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => apply(t.id)}
              className="w-full rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-white disabled:opacity-40"
            >
              <span className="text-[13px] text-appNavy">{t.name}</span>
              <span className="font-jbmono text-[11px] text-appNavy/45"> · {t.stepCount}</span>
              <span className="block text-[11.5px] text-appNavy/55">{t.when}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1.5 text-[11.5px] text-error">{error}</p>}
    </div>
  );
}

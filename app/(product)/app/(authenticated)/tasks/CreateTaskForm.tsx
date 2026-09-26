"use client";
import { useEffect, useMemo, useState } from "react";
import { createTaskAction, listAssignablePeopleAction } from "./actions";
import { useDrawerClose } from "@/components/app/Drawer";
import { useTaskList } from "./TaskListProvider";
import { useActionForm } from "@/components/app/useActionForm";

type Client = { id: string; name: string };
type Category = { id: string; name: string; clientId: string | null };
type Person = { id: string; name: string };

const SELECT_CLASS =
  "mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold disabled:opacity-40";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
    >
      {pending ? "נוצרת..." : "הוספת משימה"}
    </button>
  );
}

// Spec §11 Tasks screen + §6.1 ("Task נשמרת כישות אם המשתמש בוחר 'צור
// משימה'"). Client-then-category picker mirrors app/timer/TimerWidget.tsx
// exactly: categories are GLOBAL or scoped to the selected client.
//
// Redesign direction A: now rendered inside components/app/Drawer.tsx
// instead of an inline card above the (now-adjacent) filter bar + table -
// see docs/adr/0001 addendum. `useDrawerClose()` closes the drawer once
// the action reports `ok: true`, same pattern as CreateClientForm.
export function CreateTaskForm({
  clients,
  categories,
  defaultClientId,
}: {
  clients: Client[];
  categories: Category[];
  /// The client screen opens this form already pointed at its client.
  defaultClientId?: string;
}) {
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const close = useDrawerClose();
  const { addCreated } = useTaskList();
  // The row goes onto the list before the drawer closes, which is the
  // whole change: the screen behind this form is already correct by the
  // time the form is gone, so nothing has to go back to the server and
  // nothing can be cancelled on the way.
  const { onSubmit, pending, error } = useActionForm(createTaskAction, (result) => {
    if (result.created) addCreated(result.created);
    close();
  });

  // Ariel, 26.9.2026: "להוסיף בחירת אחראי ובחירת מפקח". Who can hold a
  // task depends on the client (only colleagues who can open it), so the
  // list is asked for once a client is chosen and asked again when it
  // changes. A choice made for the previous client is dropped with it:
  // the server would refuse a person without access to the new one, and
  // a picker still showing them would be promising something it cannot
  // keep.
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [assignedToId, setAssignedToId] = useState("");
  const [supervisorId, setSupervisorId] = useState("");

  useEffect(() => {
    setAssignedToId("");
    setSupervisorId("");
    setPeopleError(null);
    if (!clientId) {
      setPeople([]);
      return;
    }
    let current = true;
    setPeopleLoading(true);
    listAssignablePeopleAction(clientId).then((result) => {
      if (!current) return;
      setPeopleLoading(false);
      if (result.ok) setPeople(result.people);
      else {
        setPeople([]);
        setPeopleError(result.error);
      }
    });
    return () => {
      current = false;
    };
  }, [clientId]);

  const availableCategories = useMemo(
    () => categories.filter((cat) => cat.clientId === null || cat.clientId === clientId),
    [categories, clientId]
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium text-appNavy/60">לקוח *</label>
        <select
          name="clientId"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        >
          <option value="">בחירת לקוח</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">קטגוריה</label>
        <select
          name="categoryId"
          disabled={!clientId}
          className={SELECT_CLASS}
        >
          <option value="">ללא קטגוריה</option>
          {availableCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-appNavy/60">שם המשימה *</label>
        <input
          name="title"
          required
          className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
        />
      </div>

      {/* Side by side from the small breakpoint up, stacked on a phone:
          two selects in one row at 360px leave each about 150px, which
          cuts most Hebrew names in half. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="create-task-assignee" className="block text-xs font-medium text-appNavy/60">
            אחראי
          </label>
          <select
            id="create-task-assignee"
            name="assignedToId"
            value={assignedToId}
            onChange={(e) => setAssignedToId(e.target.value)}
            disabled={!clientId || peopleLoading}
            className={SELECT_CLASS}
          >
            <option value="">{peopleLoading ? "טוען..." : "ללא אחראי"}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="create-task-supervisor" className="block text-xs font-medium text-appNavy/60">
            מפקח
          </label>
          <select
            id="create-task-supervisor"
            name="supervisorId"
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
            disabled={!clientId || peopleLoading}
            className={SELECT_CLASS}
          >
            <option value="">{peopleLoading ? "טוען..." : "ללא מפקח"}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {peopleError && <p className="-mt-2 text-xs text-red-600">{peopleError}</p>}

      {/* Portal phase 1. Off by default: an internal task stays internal
          unless someone says otherwise, which is the safe direction for a
          field that decides what a client sees. The client-facing title
          is optional - left empty, the portal falls back to the task's
          own title rather than showing a blank row. */}
      <div className="rounded-lg border border-lineDark bg-cream-dim/40 p-3">
        <label className="flex items-center gap-2.5 text-xs text-appNavy">
          <input
            type="checkbox"
            name="clientVisible"
            className="h-4 w-4 rounded border-lineDark accent-gold"
          />
          הצגה ללקוח בפורטל
        </label>
        <label className="mt-2.5 block">
          <span className="block text-xs font-medium text-appNavy/60">כותרת ללקוח</span>
          <input
            name="clientTitle"
            placeholder="איך זה ייקרא אצל הלקוח. ברירת מחדל: שם המשימה"
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <SubmitButton pending={pending} />
    </form>
  );
}

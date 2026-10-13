// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The row on "הזמן שלי" that edits and deletes an entry.
//
// The property under test, in one sentence: **an accepted edit or delete
// shows on the row from the action's own answer, without waiting for the
// screen to be re-rendered.**
//
// That re-render rides home inside the action's response, and in the
// browser suite it was not applied in about one write in four: the edit
// sat on "שומר..." with the change already in the database, and a deleted
// entry stayed listed. Nothing in the props below ever changes, which is
// exactly that case: the server answered, and no new screen came.
// (claude/e2e-silent-and-racing-2026-10-12.md)

const refresh = vi.fn();
const router = { refresh, replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const updateMyEntryAction = vi.fn();
const deleteMyEntryAction = vi.fn();
vi.mock("@/app/(product)/app/(authenticated)/my-time/actions", () => ({
  updateMyEntryAction: (...args: unknown[]) => updateMyEntryAction(...args),
  deleteMyEntryAction: (...args: unknown[]) => deleteMyEntryAction(...args),
}));

import { EntryRow } from "@/app/(product)/app/(authenticated)/my-time/EntryRow";

const entry = {
  id: "e1",
  startAt: "2026-10-13T07:00:00.000Z",
  endAt: "2026-10-13T07:30:00.000Z",
  actualSeconds: 1800,
  note: "before",
  isEdited: false,
  isManual: true,
  isOverlapConfirmed: false,
  clientName: "Client",
  categoryName: "Category",
  updatedAt: "2026-10-13T08:00:00.000Z",
};

beforeEach(() => {
  refresh.mockClear();
  updateMyEntryAction.mockReset();
  deleteMyEntryAction.mockReset();
});
afterEach(() => cleanup());

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function editNoteTo(note: string) {
  fireEvent.click(screen.getByRole("button", { name: "עריכה" }));
  const field = document.querySelector('form input[name="note"]') as HTMLInputElement;
  fireEvent.change(field, { target: { value: note } });
  await act(async () => {
    fireEvent.submit(field.form!);
  });
  await settle();
}

describe("editing an entry", () => {
  it("closes on an accepted save and shows what the server wrote, with no re-render arriving", async () => {
    updateMyEntryAction.mockResolvedValue({
      ok: true,
      entry: { ...entry, note: "after", isEdited: true, updatedAt: "2026-10-13T08:05:00.000Z" },
    });
    render(<EntryRow entry={entry} />);
    await editNoteTo("after");

    expect(document.querySelector("form")).toBeNull();
    expect(screen.getByText("after")).toBeTruthy();
    expect(screen.queryByText("before")).toBeNull();
    expect(screen.getByText("נערך")).toBeTruthy();
  });

  it("stays open with the server's sentence when the save is refused", async () => {
    updateMyEntryAction.mockResolvedValue({ error: "חלון העריכה העצמית הסתיים; נדרשת הרשאת מנהל." });
    render(<EntryRow entry={entry} />);
    await editNoteTo("after");

    expect(document.querySelector("form")).not.toBeNull();
    expect(screen.getByText("חלון העריכה העצמית הסתיים; נדרשת הרשאת מנהל.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeTruthy();
  });

  it("lets the server win as soon as it sends a newer version of the entry", async () => {
    updateMyEntryAction.mockResolvedValue({
      ok: true,
      entry: { ...entry, note: "after", isEdited: true, updatedAt: "2026-10-13T08:05:00.000Z" },
    });
    const { rerender } = render(<EntryRow entry={entry} />);
    await editNoteTo("after");

    rerender(<EntryRow entry={{ ...entry, note: "changed elsewhere", updatedAt: "2026-10-13T08:10:00.000Z" }} />);
    expect(screen.getByText("changed elsewhere")).toBeTruthy();
  });
});

describe("deleting an entry", () => {
  it("takes the row off the screen on the server's word, and asks the screen to re-read once", async () => {
    deleteMyEntryAction.mockResolvedValue({ ok: true });
    render(<EntryRow entry={entry} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
    });
    await settle();

    expect(deleteMyEntryAction).toHaveBeenCalledWith("e1");
    expect(screen.queryByText("before")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the row and says why when the delete is refused", async () => {
    deleteMyEntryAction.mockResolvedValue({ error: "אין הרשאה." });
    render(<EntryRow entry={entry} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
    });
    await settle();

    expect(screen.getByText("before")).toBeTruthy();
    expect(screen.getByText("אין הרשאה.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});

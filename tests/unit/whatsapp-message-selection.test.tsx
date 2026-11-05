// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// "סמן הודעות" (4.11.2026): the mark mode on the communications screen.
// The server action is mocked; what is pinned here is the screen's side:
// nothing shows until the mode is on, the count follows the checkboxes,
// and the dialog offers a portal line only for a task the client can see.

const listTasks = vi.fn();
vi.mock("@/app/(product)/app/(authenticated)/whatsapp-poc/select-actions", () => ({
  attachSelectedMessagesAction: vi.fn(async () => ({})),
  listTasksForMessagesAction: (...args: unknown[]) => listTasks(...args),
}));

import {
  HideWhileSelecting,
  MessageSelectionProvider,
  SelectModeButton,
  SelectToggle,
} from "@/app/(product)/app/(authenticated)/whatsapp-poc/MessageSelection";

const m = (id: string, text: string, files: Array<{ id: string; type: string; label: string }> = []) => ({
  id,
  at: "2026-11-04T08:31:00.000Z",
  text,
  mine: false,
  senderName: null,
  files,
});

function Screen() {
  return (
    <MessageSelectionProvider
      chatId="chat1"
      numberKey="n1"
      contactName="רותם כהן"
      phone="+972501234567"
      clients={[{ id: "c1", name: "לקוח א" }]}
      defaultClientId="c1"
      proposedTitle="מעקב: שיחה עם רותם כהן"
    >
      <SelectModeButton />
      <HideWhileSelecting>
        <button type="button">צור משימה מהשיחה</button>
      </HideWhileSelecting>
      <ul>
        <li>
          <SelectToggle message={m("m1", "אפשר לקבוע פגישה?")} />
        </li>
        <li>
          <SelectToggle message={m("m2", "", [{ id: "f1", type: "img", label: "תמונה" }])} />
        </li>
      </ul>
    </MessageSelectionProvider>
  );
}

afterEach(() => {
  cleanup();
  listTasks.mockReset();
});

describe("message selection", () => {
  it("shows no checkboxes and no bar until the mode is on", () => {
    render(<Screen />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "הודעות שסומנו" })).toBeNull();
  });

  it("counts what is checked, images apart, and clears when the mode ends", () => {
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: "סמן הודעות" }));
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect((screen.getByRole("button", { name: "צרף למשימה קיימת" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    expect(screen.getByRole("region", { name: "הודעות שסומנו" }).textContent).toContain("2 הודעות נבחרו");
    expect(screen.getByRole("region", { name: "הודעות שסומנו" }).textContent).toContain("תמונה אחת");

    fireEvent.click(screen.getByRole("button", { name: "סיום סימון" }));
    fireEvent.click(screen.getByRole("button", { name: "סמן הודעות" }));
    expect(screen.getByRole("region", { name: "הודעות שסומנו" }).textContent).toContain("0 הודעות נבחרו");
  });

  it("hides the older task form while marking and offers two ways out (4.11.2026)", () => {
    render(<Screen />);
    expect(screen.getByRole("button", { name: "צור משימה מהשיחה" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "סמן הודעות" }));
    expect(screen.queryByRole("button", { name: "צור משימה מהשיחה" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "יציאה מסימון" }));
    expect(screen.queryByRole("region", { name: "הודעות שסומנו" })).toBeNull();
    expect(screen.getByRole("button", { name: "צור משימה מהשיחה" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "סמן הודעות" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "הודעות שסומנו" })).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("offers the portal line only for a task the client can see", async () => {
    listTasks.mockResolvedValue([
      { id: "t1", title: "תיאום פגישות · נובמבר", status: "IN_PROGRESS", clientVisible: true },
      { id: "t2", title: "פנימית", status: "OPEN", clientVisible: false },
    ]);
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: "סמן הודעות" }));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "צרף למשימה קיימת" }));

    await waitFor(() => expect(listTasks).toHaveBeenCalledWith({ clientId: "c1", q: "" }));
    const portal = (await screen.findByRole("checkbox", { name: "להוסיף שורה לרשימה שהלקוח רואה בפורטל" })) as HTMLInputElement;
    expect(portal.disabled).toBe(true);

    fireEvent.click(await screen.findByRole("radio", { name: /פנימית/ }));
    expect(portal.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /תיאום פגישות/ }));
    expect(portal.disabled).toBe(false);

    fireEvent.click(portal);
    expect(screen.getByLabelText("השורה שהלקוח יראה (בלי תוכן ההודעות)")).toBeTruthy();
  });
});

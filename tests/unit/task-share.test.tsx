// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TaskShare, type SharePerson } from "@/app/(product)/app/(authenticated)/tasks/[id]/TaskShare";

// "שיתוף" on a task (28.10.2026). Nothing is sent from the app: the two
// links open a draft in the person's own mail or WhatsApp. So the property
// under test is the links themselves - who they reach, and that the
// message carries the task, its link and the person's note.

const TASK = {
  title: "מעקב פרויקט פניות",
  clientName: "Grantor",
  statusLabel: "פתוחה",
  dueDate: null,
  priorityLabel: null,
};
const URL = "https://ankora.example/app/tasks/t1";
const PEOPLE: SharePerson[] = [
  { id: "u1", name: "הדס לוי", email: "hadas@example.com", whatsappNumber: "052-123-4567" },
  { id: "u2", name: "נועה כהן", email: "noa@example.com", whatsappNumber: null },
];

function decoded(testId: string): string {
  return decodeURIComponent(screen.getByTestId(testId).getAttribute("href") ?? "");
}

afterEach(cleanup);

describe("TaskShare", () => {
  it("opens WhatsApp and mail to the chosen colleague, with the task, its link and the note", () => {
    render(<TaskShare task={TASK} url={URL} people={PEOPLE} defaultRecipientId="u1" onDone={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/העברתי אלייך/), { target: { value: "העברתי אלייך" } });

    const wa = decoded("task-share-whatsapp");
    expect(wa.startsWith("https://wa.me/972521234567?text=")).toBe(true);
    for (const part of ["היי הדס,", "העברתי אלייך", TASK.title, "Grantor", URL]) expect(wa).toContain(part);

    const mail = decoded("task-share-mail");
    expect(mail.startsWith("mailto:hadas@example.com?subject=")).toBe(true);
    expect(mail).toContain(URL);
    expect(mail).toContain("העברתי אלייך");
  });

  it("says whose number is missing instead of linking to nobody", () => {
    render(<TaskShare task={TASK} url={URL} people={PEOPLE} defaultRecipientId="u2" onDone={vi.fn()} />);

    expect(screen.queryByTestId("task-share-whatsapp")).toBeNull();
    expect(screen.getByTestId("task-share-no-whatsapp").textContent).toContain("נועה כהן");
    expect(decoded("task-share-mail").startsWith("mailto:noa@example.com?")).toBe(true);
  });

  it("with no recipient, lets WhatsApp pick the contact", () => {
    render(<TaskShare task={TASK} url={URL} people={PEOPLE} defaultRecipientId={null} onDone={vi.fn()} />);

    expect(decoded("task-share-whatsapp").startsWith("https://wa.me/?text=")).toBe(true);
    expect(decoded("task-share-mail").startsWith("mailto:?subject=")).toBe(true);
  });
});

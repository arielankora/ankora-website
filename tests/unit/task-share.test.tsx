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

    const gmail = decoded("task-share-mail");
    expect(gmail.startsWith("https://mail.google.com/mail/?view=cm&fs=1&to=hadas@example.com&su=")).toBe(true);
    expect(gmail).toContain(URL);
    expect(gmail).toContain("העברתי אלייך");
    expect(screen.getByTestId("task-share-mail").getAttribute("target")).toBe("_blank");

  });

  it("says whose number is missing instead of linking to nobody", () => {
    render(<TaskShare task={TASK} url={URL} people={PEOPLE} defaultRecipientId="u2" onDone={vi.fn()} />);

    expect(screen.queryByTestId("task-share-whatsapp")).toBeNull();
    expect(screen.getByTestId("task-share-no-whatsapp").textContent).toContain("נועה כהן");
    expect(decoded("task-share-mail")).toContain("to=noa@example.com&");
  });

  it("with no recipient, lets WhatsApp pick the contact", () => {
    render(<TaskShare task={TASK} url={URL} people={PEOPLE} defaultRecipientId={null} onDone={vi.fn()} />);

    expect(decoded("task-share-whatsapp").startsWith("https://wa.me/?text=")).toBe(true);
    expect(decoded("task-share-mail")).toContain("&to=&su=");
    expect(screen.queryByTestId("task-share-mailto")).toBeNull();
  });

  // 31.10.2026: a click on "מייל" used to do nothing visible in a browser
  // with no mail app. Every action now says what happened.
  it("says what happened after the mail button is clicked", () => {
    render(<TaskShare task={TASK} url={URL} people={PEOPLE} defaultRecipientId="u1" onDone={vi.fn()} />);
    expect(screen.queryByTestId("task-share-feedback")).toBeNull();

    expect(screen.queryByTestId("task-share-rtl-hint")).toBeNull();

    fireEvent.click(screen.getByTestId("task-share-mail"));
    expect(screen.getByTestId("task-share-feedback").textContent).toContain("Gmail");
    // Gmail takes no direction from the link, so the panel says how to
    // right-align the draft there (1.11.2026).
    expect(screen.getByTestId("task-share-rtl-hint").textContent).toContain("Right-to-left editing support");
  });

  // A browser signed in to a private Google account too would open the
  // draft there; authuser picks the sharer's work account.
  it("opens the draft in the sharer's own Google account", () => {
    render(
      <TaskShare
        task={TASK}
        url={URL}
        people={PEOPLE}
        defaultRecipientId="u1"
        senderEmail="ariel@ankora.co.il"
        onDone={vi.fn()}
      />
    );
    expect(
      decoded("task-share-mail").startsWith("https://mail.google.com/mail/?authuser=ariel@ankora.co.il&view=cm&fs=1&to=hadas@example.com&su=")
    ).toBe(true);
  });

  it("copies the whole message and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<TaskShare task={TASK} url={URL} people={PEOPLE} defaultRecipientId="u1" onDone={vi.fn()} />);

    fireEvent.click(screen.getByTestId("task-share-copy"));
    expect(await screen.findByText(/ההודעה הועתקה/)).toBeTruthy();
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain(TASK.title);
    expect(copied).toContain(URL);
  });
});

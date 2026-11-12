// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { intlWrapper } from "../helpers/intl";

// 4.11.2026: the admin "דיווחי זמן" edit row, after the closed-bank notice.
//
// The row used a `<form action>`, and React resets such a form once the
// action returns. So when the server answered with the closed-bank notice,
// the fields were back to the stored values, and the manager's override
// resubmitted the old entry unchanged. Found by a Cowork run moving the
// RIMED entry (task cmvxjhbgj000hii085escrx7v).

const router = { refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/app/toast/ToastProvider", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const adminUpdateEntryAction = vi.fn();
vi.mock("@/app/(product)/app/(authenticated)/time-entries/actions", () => ({
  adminUpdateEntryAction: (...args: unknown[]) => adminUpdateEntryAction(...args),
  deleteEntryAction: vi.fn(),
  restoreEntryAction: vi.fn(),
  getEntryRevisionsAction: vi.fn(async () => []),
}));

import { AdminEntryRow } from "@/app/(product)/app/(authenticated)/time-entries/AdminEntryRow";

const entry = {
  id: "e1",
  startAt: "2026-11-01T23:00:00.000Z", // 2.11 01:00 in Israel
  endAt: "2026-11-01T23:25:00.000Z",
  actualSeconds: 1500,
  billableSeconds: 1500,
  note: "עבודה מ-1.11: מעקב יומי",
  isEdited: false,
  isOverlapConfirmed: false,
  source: "MANUAL",
  userName: "Ariel",
  clientName: "RIMED",
  categoryName: "גיוס וhr",
  updatedAt: "2026-11-02T19:00:00.000Z",
};

const notice = {
  message: "החבילה מ-11.10.2026 נסגרה ב-2.11.2026. אי אפשר לשנות רישום בחבילה או מחזור סגורים.",
  canMoveToOpen: false,
  canOverride: true,
  overrideWarning: "אתה עומד לשנות חבילה או מחזור סגורים. האם אתה בטוח שאתה רוצה לבצע שינוי כזה?",
};

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => adminUpdateEntryAction.mockReset());
afterEach(() => cleanup());

describe("admin edit row, closed hour bank", () => {
  it("keeps the edited values through the notice, and the override sends them with the reason", async () => {
    adminUpdateEntryAction.mockResolvedValueOnce({ closedBank: notice }).mockResolvedValueOnce({ ok: true });
    const { container } = render(
      <table>
        <tbody>
          <AdminEntryRow entry={entry} selected={false} onToggleSelect={() => {}} />
        </tbody>
      </table>,
      { wrapper: intlWrapper() }
    );
    fireEvent.click(screen.getByText("עריכה"));

    const field = (name: string) => container.querySelector(`[name="${name}"]`) as HTMLInputElement;
    fireEvent.change(field("startTime"), { target: { value: "22:45" } });
    fireEvent.change(field("endTime"), { target: { value: "23:10" } });
    fireEvent.change(field("note"), { target: { value: "עבודה מ-1.11: מעקב יומי. עבודה מ-1.11, נרשמה אחרי טעינת החבילה ב-2.11." } });

    fireEvent.submit(container.querySelector("form")!);
    await settle();

    expect(screen.getByText(notice.message)).toBeTruthy();
    expect(field("startTime").value).toBe("22:45");
    expect(field("endTime").value).toBe("23:10");

    fireEvent.click(screen.getByText("לשנות את החבילה הסגורה בכל זאת"));
    expect(screen.getByText(notice.overrideWarning)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/סיבה \(חובה/), { target: { value: "העברה לחבילה הפתוחה" } });
    fireEvent.click(screen.getByText("כן, לבצע את השינוי"));
    await settle();

    const sent = adminUpdateEntryAction.mock.calls[1][1] as FormData;
    expect(sent.get("startTime")).toBe("22:45");
    expect(sent.get("endTime")).toBe("23:10");
    expect(sent.get("closedBankOverrideReason")).toBe("העברה לחבילה הפתוחה");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The role and status form on a user's page. The property under test:
// **after a save, the selects show what was saved, from the action's own
// answer, even though the page's props have not changed and React has
// reset the form.** On the preview of PR #212 they showed the values from
// before the save until a reload (pre-existing on main).

const updateUserRoleStatusAction = vi.fn();
vi.mock("@/app/(product)/app/(authenticated)/users/actions", () => ({
  updateUserRoleStatusAction: (...args: unknown[]) => updateUserRoleStatusAction(...args),
}));

import { EditRoleStatusForm } from "@/app/(product)/app/(authenticated)/users/[userId]/EditRoleStatusForm";

afterEach(() => {
  cleanup();
  updateUserRoleStatusAction.mockReset();
});

function selects() {
  const all = screen.getAllByRole("combobox") as HTMLSelectElement[];
  return { role: all[0], status: all[1] };
}

describe("EditRoleStatusForm", () => {
  it("shows the saved status and role after the save, with the props unchanged", async () => {
    updateUserRoleStatusAction.mockResolvedValue({ ok: true, saved: { role: "ANKORA_ADMIN", status: "ACTIVE" } });
    render(<EditRoleStatusForm targetUser={{ id: "u1", role: "ANKORA_EMPLOYEE", status: "SUSPENDED" }} isSelf={false} />);

    fireEvent.change(selects().status, { target: { value: "ACTIVE" } });
    fireEvent.change(selects().role, { target: { value: "ANKORA_ADMIN" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "שמירת שינויים" }));
    });

    expect(await screen.findByText("נשמר בהצלחה.")).toBeTruthy();
    const fd = updateUserRoleStatusAction.mock.calls[0][1] as FormData;
    expect(fd.get("status")).toBe("ACTIVE");
    expect(selects().status.value).toBe("ACTIVE");
    expect(selects().role.value).toBe("ANKORA_ADMIN");

    // And a form reset now lands on the saved values, not the old ones.
    act(() => (selects().status.form as HTMLFormElement).reset());
    expect(selects().status.value).toBe("ACTIVE");
    expect(selects().role.value).toBe("ANKORA_ADMIN");
  });

  it("starts from the row the page rendered", () => {
    render(<EditRoleStatusForm targetUser={{ id: "u1", role: "ANKORA_EMPLOYEE", status: "INVITED" }} isSelf={false} />);
    expect(selects().status.value).toBe("INVITED");
    expect(selects().role.value).toBe("ANKORA_EMPLOYEE");
  });
});

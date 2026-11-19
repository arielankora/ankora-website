// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { intlWrapper } from "../helpers/intl";
import { ProposalChanges } from "@/app/(product)/app/(authenticated)/knowledge/ProposalChanges";
import { proposalChanges } from "@/lib/proposal-changes";

// 19.11.2026: an update to a contact shows, per field, what the file says
// today and after approval (option A), one line per field on a phone
// (option B). Nothing is struck out: the item stays.

afterEach(cleanup);

const changes = proposalChanges(
  { role: "רואה החשבון של מאיה", knowledgeStatus: "UNCERTAIN", systemNames: ["Priority"] },
  { name: "חיים אוליאל", role: null, knowledgeStatus: "CONFIRMED" }
);

describe("ProposalChanges", () => {
  it("shows a table of field, today and after approval, in Hebrew", () => {
    render(<ProposalChanges changes={changes} />, { wrapper: intlWrapper("he") });
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "היום בתיק" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "אחרי האישור" })).toBeTruthy();
    const role = within(table).getByRole("row", { name: /תפקיד/ });
    expect(role.textContent).toContain("לא כתוב");
    expect(role.textContent).toContain("רואה החשבון של מאיה");
    expect(within(table).getByRole("row", { name: /סטטוס/ }).textContent).toContain("לא ודאי");
    expect(within(table).getByRole("row", { name: /מערכות/ }).textContent).toContain("לא מוצג כאן");
    expect(screen.getByText("שאר הפרטים נשארים כמו שהם.")).toBeTruthy();
    expect(document.querySelector(".line-through")).toBeNull();
  });

  it("words the codes from the English dictionary", () => {
    render(<ProposalChanges changes={changes} />, { wrapper: intlWrapper("en") });
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /Status/ }).textContent).toContain("Uncertain");
    expect(within(table).getByRole("row", { name: /Role/ }).textContent).toContain("Not written");
  });

  it("shows nothing when nothing changes", () => {
    const { container } = render(<ProposalChanges changes={[]} />, { wrapper: intlWrapper("he") });
    expect(container.textContent).toBe("");
  });
});

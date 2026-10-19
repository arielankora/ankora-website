import { describe, expect, it } from "vitest";
import { backTitle } from "@/app/(product)/app/(authenticated)/tasks/list-query";
import { clientsBackTitle, importantDatesBackTitle } from "@/lib/list-back";

// The words on the way back (19.10.2026): they name the list a detail
// screen returns to, so a person sees where "back" leads before using it.
describe("backTitle (tasks)", () => {
  it("names the default list", () => {
    expect(backTitle(undefined)).toBe("משימות · שלי");
  });

  it("names every filter that is set, with the names it was given", () => {
    const from = new URLSearchParams({ mine: "0", status: "OPEN", clientId: "c1", categoryId: "k1", q: "חוזה", view: "board" }).toString();
    expect(backTitle(from, { client: "בן-דוד ושות׳", category: "ניהול משרד" })).toBe(
      'משימות · כולם · פתוחות · בן-דוד ושות׳ · ניהול משרד · "חוזה" · לוח',
    );
  });

  it("leaves out a client or category the caller could not name", () => {
    const from = new URLSearchParams({ clientId: "not-mine", categoryId: "k9" }).toString();
    expect(backTitle(from, {})).toBe("משימות · שלי");
  });

  it("ignores keys that are not the list's, and shortens a long search", () => {
    expect(backTitle("evil=1&status=NOPE")).toBe("משימות · שלי");
    expect(backTitle(`q=${"א".repeat(60)}`)).toBe(`משימות · שלי · "${"א".repeat(40)}…"`);
  });

  it("says the calendar when it came from the calendar", () => {
    expect(backTitle("calendar:view=week")).toBe("חזרה ליומן");
  });
});

describe("clients and important dates", () => {
  it("names the clients search", () => {
    expect(clientsBackTitle(undefined)).toBe("לקוחות");
    expect(clientsBackTitle("q=כהן")).toBe('לקוחות · "כהן"');
    expect(clientsBackTitle("evil=1")).toBe("לקוחות");
  });

  it("names the important-dates tab", () => {
    expect(importantDatesBackTitle("tab=done")).toBe("מועדים חשובים · טופלו");
    expect(importantDatesBackTitle("tab=upcoming")).toBe("מועדים חשובים");
    expect(importantDatesBackTitle(null)).toBe("מועדים חשובים");
  });
});

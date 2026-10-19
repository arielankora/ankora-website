import { describe, expect, it } from "vitest";
import { autoTaskTitle, reminderTitle } from "@/lib/date-receipt";

describe("ממתין לקבלה", () => {
  it("asks to make sure it came, from whom; an ordinary date stays as it is", () => {
    expect(reminderTitle({ title: "דוח ספקים", expectsReceipt: true, expectedFrom: "איילה" })).toBe("ממתין לקבלה: דוח ספקים (מ-איילה)");
    expect(autoTaskTitle({ title: "דוח ספקים", expectsReceipt: true })).toBe("לוודא שהתקבל: דוח ספקים");
    expect(autoTaskTitle({ title: "דוח ספקים", expectsReceipt: false, expectedFrom: "איילה" })).toBe("דוח ספקים");
    expect(autoTaskTitle({ title: "א".repeat(250), expectsReceipt: true })).toHaveLength(200);
  });
});

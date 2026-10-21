import { describe, expect, it } from "vitest";
import { contentWords, coveredTasks, sameForm, taskCoveredBy } from "@/lib/process-task-overlap";

// Open tasks an approved process already covers: the NUX tasks from 3.10
// beside P5, and the ones that must not be offered.

const P5 = {
  title: "מעקב חופשות, מחלות ושינויים בהעסקה ודיווח חודשי לשכר",
  purpose: 'לרשום כל חודש חופשות, מחלות, מילואים ושינויים בהעסקה של עובדי NUX, ולדווח לשכר בישראל (Nextage) ובארה"ב (JustWorks).',
};
const P1 = { title: "ניהול משתמשים והרשאות ב-Google Workspace", purpose: "פתיחה, סגירה ושינוי של משתמשים והרשאות ב-Google Workspace של NUX, עם תיעוד לצורך SOC 2." };
const P4 = { title: 'איסוף ותיוק קבלות הוצאות ארה"ב', purpose: "שלכל חיוב של החברה האמריקאית תהיה קבלה מתויקת" };

describe("taskCoveredBy", () => {
  it("the same work under another title", () => {
    expect(taskCoveredBy({ title: "מעקב חופשות, Leave ושינויים בהעסקה" }, P5)).not.toBeNull();
    expect(taskCoveredBy({ title: "ניהול Google Workspace" }, P1)).not.toBeNull();
  });
  it("a task that shares a word or two is not the process", () => {
    expect(taskCoveredBy({ title: "הגשת דיווחי Payroll בישראל ומעקב Form 101 והסכמים" }, P5)).toBeNull();
    expect(taskCoveredBy({ title: "ניהול Payroll בארה״ב דרך Justworks" }, P5)).toBeNull();
    expect(taskCoveredBy({ title: "התאמת עסקאות כרטיסי אשראי ובנק מול קבלות" }, P4)).toBeNull();
    expect(taskCoveredBy({ title: "הזמנת טכנאי לבר מים אלקטרה, נזילה" }, P1)).toBeNull();
  });
  it("needs a word of the title, not only of the purpose", () => {
    expect(taskCoveredBy({ title: "מילואים של עובדי NUX" }, { title: "דוח רבעוני", purpose: "מילואים ועובדי NUX" })).toBeNull();
  });
  it("words in another form", () => {
    expect(sameForm("ומעקב", "מעקב")).toBe(true);
    expect(sameForm("דיווחי", "דיווח")).toBe(true);
    expect(sameForm("אורן", "אורנה")).toBe(false);
    expect(contentWords("של את 2026 Form")).toEqual(["form"]);
  });
});

describe("coveredTasks", () => {
  it("only open tasks of their own, against approved processes", () => {
    const tasks = [
      { id: "t1", title: "מעקב חופשות, Leave ושינויים בהעסקה", status: "IN_PROGRESS", processId: null, parentId: null },
      { id: "t2", title: "מעקב חופשות ושינויים בהעסקה", status: "OPEN", processId: "p5", parentId: null },
      { id: "t3", title: "מעקב חופשות ושינויים בהעסקה", status: "DONE", processId: null, parentId: null },
      { id: "t4", title: "מעקב חופשות ושינויים בהעסקה", status: "OPEN", processId: null, parentId: "t1" },
    ];
    const processes = [
      { id: "p5", code: "P5", ...P5, status: "ACTIVE" },
      { id: "p6", code: "P6", ...P5, status: "DRAFT" },
    ];
    expect(coveredTasks(processes, tasks).map((x) => [x.processId, x.taskId])).toEqual([["p5", "t1"]]);
  });
});

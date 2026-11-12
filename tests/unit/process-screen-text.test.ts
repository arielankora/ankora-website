import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import he from "../../messages/he.json";
import en from "../../messages/en.json";
import { nextSteps, type ProcessFacts, type StepText } from "@/lib/next-steps";
import {
  ACTION_TAG_LABELS,
  CHANNEL_LABELS,
  FIELD_LABELS,
  STEP_MODE_LABELS,
  TRANSITION_LABELS,
  TRIGGER_LABELS,
  blockingChecks,
  documentationLine,
  type CheckResult,
  type ProcessStep,
} from "@/lib/process-rules";
import { BRANCH_SOURCE_LABELS, SEND_MODE_LABELS, flowIssues, flowTree, type FlowIssue, type FlowNode, type ProcessFlow } from "@/lib/process-flow";
import { runBlockerKey, runBlockers } from "@/lib/process-readiness";
import { readinessLine, readinessLineText, readinessOf, READINESS_CHECKS, type ReadinessProcessInput, type ReadinessText } from "@/lib/handover-readiness";
import { CHECK_STATE_LABELS, checkEveryText } from "@/lib/process-checks";
import { REVIEW_REASON_LABELS } from "@/lib/process-review";
import { STRANGER_ASK_WHO_LABELS, STRANGER_SEVERITY_LABELS, strangerLine, type StrangerState } from "@/lib/stranger-test";
import { LESSON_STATUS_LABELS } from "@/lib/process-lessons";
import { BUSINESS_CALENDAR_LABELS } from "@/lib/business-calendar";
import { dayLabel } from "@/lib/process-visual";
import { SYSTEM_ACCESS_STATUS_LABELS } from "@/lib/system-map";

/**
 * ADR 0006, the processes screens. lib/ keeps its Hebrew sentences for
 * every reader that is not a screen (the client file, Claude, documents,
 * stored approvals), and gives the screens the same lines as keys. These
 * tests hold the two together: worded from the Hebrew dictionary, every
 * keyed line is the Hebrew sentence lib/ has always produced, character
 * for character, so the Hebrew screen did not change. And every key the
 * screens build at runtime exists in English too.
 */

type Tx = (key: string, values?: Record<string, string | number>) => string;

function translator(locale: "he" | "en", namespace: string): Tx {
  const t = createTranslator({
    locale: locale === "he" ? "he-IL" : "en-IL",
    messages: locale === "he" ? he : en,
    timeZone: "Asia/Jerusalem",
    namespace: namespace as never,
    onError: (error) => {
      throw error;
    },
  });
  return t as unknown as Tx;
}

const heP = translator("he", "clients.processes");
const enP = translator("en", "clients.processes");

function stepText(t: Tx, x: StepText): string {
  if ("raw" in x) return x.raw;
  const refs = Object.fromEntries(Object.entries(x.refs ?? {}).map(([k, key]) => [k, t(key)]));
  return t(x.key, { ...x.values, ...refs });
}

const blank = (x: StepText): StepText => ("raw" in x ? x : { ...x, values: Object.fromEntries(Object.entries(x.values ?? {}).map(([k, v]) => [k, typeof v === "number" ? v : "X"])) });

function facts(over: Partial<ProcessFacts> = {}): ProcessFacts {
  return {
    id: "p5",
    code: "P5",
    title: "דיווח חודשי לשכר",
    status: "ACTIVE",
    triggerKinds: ["SCHEDULED"],
    ownerId: "hadas",
    hasNextDate: true,
    draft: null,
    covered: [],
    missing: [],
    noAccess: [],
    review: null,
    openLessons: 0,
    knowledge: { uncertain: false, toResolve: null },
    dateCandidate: null,
    ...over,
  };
}

const FACTS: ProcessFacts[] = [
  facts({ hasNextDate: false, dateCandidate: { id: "d1", title: "שליחת טבלת השכר (P5)" } }),
  facts({ hasNextDate: false }),
  facts({ status: "DRAFT", hasNextDate: false }),
  facts({ draft: { version: 2, blocked: false } }),
  facts({ status: "DRAFT", draft: { version: 3, blocked: false } }),
  facts({ draft: { version: 2, blocked: true } }),
  facts({ review: { label: REVIEW_REASON_LABELS.PERIODIC, periodic: true, reason: "PERIODIC" } }),
  facts({ review: { label: REVIEW_REASON_LABELS.RULES, periodic: false, reason: "RULES" } }),
  facts({ review: { label: "סומן לסקירה", periodic: false } }),
  facts({ covered: [{ taskId: "t1", title: "שכר" }] }),
  facts({ covered: [{ taskId: "t1", title: "שכר" }, { taskId: "t2", title: "דיווח" }] }),
  facts({ covered: [{ taskId: "t1", title: "a" }, { taskId: "t2", title: "b" }, { taskId: "t3", title: "c" }] }),
  facts({ openLessons: 1 }),
  facts({ openLessons: 4 }),
  facts({ knowledge: { uncertain: true, toResolve: "לשאול את דקלה" } }),
  facts({ knowledge: { uncertain: true, toResolve: null } }),
  facts({ suggestions: { systems: [{ id: "s1", name: "בנק לאומי" }], contacts: [{ id: "c1", name: "דקלה כרמי" }] } }),
  facts({ doc: [{ field: "sla", label: FIELD_LABELS.sla }, { field: "exceptions", label: FIELD_LABELS.exceptions }], canMarkNotApplicable: true }),
  facts({ missing: [FIELD_LABELS.sla, FIELD_LABELS.owner] }),
  facts({ noAccess: ["Mercury", "Hilan"] }),
  ...runBlockers({ status: "DRAFT", ownerId: null, triggerKinds: [], triggerText: null, nextDate: null })
    .concat(runBlockers({ status: "PAUSED", ownerId: "x", triggerKinds: ["EVENT"], triggerText: "x", nextDate: null }))
    .concat(runBlockers({ status: "RETIRED", ownerId: "x", triggerKinds: ["EVENT"], triggerText: "x", nextDate: null }))
    .concat(runBlockers({ status: "ACTIVE", ownerId: "x", triggerKinds: ["CONTINUOUS"], triggerText: "x", nextDate: null, checkEveryDays: null }))
    .map((blocker) => facts({ triggerKinds: ["EVENT"], readiness: { ready: false, blocker } })),
];

describe("next steps in the reader's language", () => {
  it("word every step, in Hebrew, exactly as lib/next-steps writes it", () => {
    let seen = 0;
    for (const f of FACTS) {
      for (const manager of [true, false]) {
        for (const step of nextSteps(f, manager)) {
          seen++;
          const x = step.text!;
          expect(x, step.kind).toBeDefined();
          expect(stepText(heP, x.title)).toBe(step.title);
          expect(x.recommend ? stepText(heP, x.recommend) : null).toBe(step.recommend);
          expect(x.why ? stepText(heP, x.why) : null).toBe(step.why);
          expect(stepText(heP, x.fix)).toBe(step.fix.label);
          expect(x.alt ? stepText(heP, x.alt) : undefined).toBe(step.alt?.label);
          // And the English exists and is not the Hebrew.
          // Values are what people wrote (a date's title, a task's), so
          // they are blanked before looking for Hebrew in the sentence.
          for (const line of [x.title, x.recommend, x.why, x.fix, x.alt]) if (line && !("raw" in line)) expect(stepText(enP, blank(line))).not.toMatch(/\p{Script=Hebrew}/u);
        }
      }
    }
    expect(seen).toBeGreaterThan(30);
  });
});

const step = (over: Partial<ProcessStep> = {}): ProcessStep => ({
  title: "שלב",
  mode: "MANUAL",
  offsetBusinessDays: null,
  actionTags: [],
  systemIds: [],
  output: null,
  verification: null,
  requiresApproval: false,
  amountMaxMinor: null,
  currency: null,
  channel: null,
  ...over,
});

function checkText(t: Tx, c: CheckResult): string {
  const k = c.keyed!;
  return t(`checks.${k.key}`, {
    step: k.step ?? "",
    tags: (k.tags ?? []).map((x) => t(`labels.actionTags.${x}`)).join(", "),
    thresholds: (k.thresholds ?? []).join(", "),
    secrets: (k.secrets ?? []).map((x) => t(`labels.secrets.${x}`)).join(", "),
  });
}

describe("procedure checks in the reader's language", () => {
  it("word every check, in Hebrew, exactly as lib/process-rules writes it", () => {
    const checks = blockingChecks(
      {
        steps: [
          step({ mode: "AUTOMATED", actionTags: ["PAYMENT", "REFUND"], verification: "x" }),
          step({ mode: "ASSISTED", actionTags: ["BANK_SIGNATURE"] }),
          step({ mode: "AUTOMATED", actionTags: ["CLIENT_MESSAGE"] }),
        ],
        highlights: "password: hunter22 sk-abcdefghijklmnopqrstuvwxyz",
      },
      ["מעל 5,000 ש\"ח", "ספק חדש"]
    );
    expect(checks.map((c) => c.keyed?.key)).toEqual(["humanOnlyAutomated", "humanOnlyAssisted", "clientMessageAutomated", "automatedNoVerification", "moneyNoApproval", "secrets"]);
    for (const c of checks) {
      expect(checkText(heP, c)).toBe(c.message);
      expect(checkText(enP, { ...c, keyed: { ...c.keyed!, thresholds: c.keyed!.thresholds?.map(() => "X") } })).not.toMatch(/\p{Script=Hebrew}/u);
    }
  });
});

const node = (over: Partial<FlowNode>): FlowNode => ({
  id: "n1",
  kind: "ACTION",
  title: "",
  waitBusinessDays: null,
  owner: null,
  position: null,
  step: step(),
  send: null,
  next: null,
  question: null,
  branches: [],
  elseLabel: null,
  elseAfterBusinessDays: null,
  elseNext: null,
  ...over,
});

function issueText(t: Tx, i: FlowIssue): string {
  const name = i.keyed!.title ? `"${i.keyed!.title}"` : t("flow.unnamedNode");
  return t(`flow.issues.${i.keyed!.key}`, { ...i.keyed!.values, node: name });
}

describe("flow issues in the reader's language", () => {
  const flows: ProcessFlow[] = [
    { v: 1, start: null, nodes: [] },
    {
      v: 1,
      start: "a",
      nodes: [
        node({ id: "a", title: "שליחה", send: { mode: "AUTO", toContactId: null, toText: null, body: null }, next: "zz" }),
        node({ id: "b", title: "", send: { mode: "DRAFT", toContactId: null, toText: null, body: "שלום {{שם}}" } }),
        node({
          id: "c",
          kind: "CONDITION",
          title: "תנאי",
          step: null,
          branches: [
            { id: "b1", label: "", source: "EMAIL_REPLY", connectionId: null, ref: "c", next: null },
            { id: "b2", label: "", source: "DRIVE_FILE", connectionId: null, ref: null, next: null },
          ],
        }),
        node({ id: "d", kind: "CONDITION", title: "", step: null, branches: [], elseAfterBusinessDays: null }),
        node({ id: "a", title: "כפול", next: "a" }),
      ],
    },
    {
      v: 1,
      start: "x",
      nodes: [node({ id: "x", title: "א", next: "y" }), node({ id: "y", title: "ב", next: "x" })],
    },
    {
      v: 1,
      start: "s1",
      nodes: [...Array.from({ length: 16 }, (_, i) => node({ id: `s${i + 1}`, title: `שלב ${i + 1}`, next: i < 15 ? `s${i + 2}` : "end" })), node({ id: "end", kind: "END", title: "סיום", step: null })],
    },
  ];

  it("word every issue, in Hebrew, exactly as lib/process-flow writes it", () => {
    const keys = new Set<string>();
    for (const flow of flows) {
      for (const i of flowIssues(flow)) {
        expect(i.keyed, i.message).toBeDefined();
        keys.add(i.keyed!.key);
        expect(issueText(heP, i)).toBe(i.message);
        expect(issueText(enP, i).replace(/"[^"]*"|\{\{[^}]*\}\}|: [^.]*\./g, "")).not.toMatch(/\p{Script=Hebrew}/u);
      }
    }
    expect(keys.size).toBeGreaterThan(12);
  });

  it("names a branch on the phone's tree as before, unless the screen words it", () => {
    const flow: ProcessFlow = {
      v: 1,
      start: "c",
      nodes: [
        node({ id: "c", kind: "CONDITION", title: "q", question: "q", step: null, branches: [{ id: "b1", label: "", source: "CLAUDE", connectionId: null, ref: null, next: "e" }], elseAfterBusinessDays: 3, elseNext: "e" }),
        node({ id: "e", kind: "END", title: "סיום", step: null }),
      ],
    };
    const before = flowTree(flow).map((l) => l.branch);
    expect(before).toContain(BRANCH_SOURCE_LABELS.CLAUDE);
    expect(before).toContain("אחרת, אחרי 3 ימים");
    const worded = flowTree(flow, { source: (s) => heP(`labels.branchSources.${s}`), otherwise: (d) => heP("flow.otherwiseTree", { days: String(d ?? "?") }) }).map((l) => l.branch);
    expect(worded).toEqual(before);
  });
});

describe("readiness and handover in the reader's language", () => {
  it("names every reason a process will not run", () => {
    const all = [
      ...runBlockers({ status: "DRAFT", ownerId: null, triggerKinds: [], triggerText: null, nextDate: null }),
      ...runBlockers({ status: "PAUSED", ownerId: null, triggerKinds: [], triggerText: null, nextDate: null }),
      ...runBlockers({ status: "RETIRED", ownerId: null, triggerKinds: [], triggerText: null, nextDate: null }),
      ...runBlockers({ status: "ACTIVE", ownerId: "x", triggerKinds: ["SCHEDULED"], triggerText: "x", nextDate: null }),
      ...runBlockers({ status: "ACTIVE", ownerId: "x", triggerKinds: ["CONTINUOUS"], triggerText: "x", nextDate: null, checkEveryDays: null }),
    ];
    expect(new Set(all).size).toBe(7);
    for (const b of all) {
      const key = runBlockerKey(b);
      expect(key, b).not.toBeNull();
      expect(heP(`readiness.blockers.${key}`)).toBe(b);
      expect(enP(`readiness.blockers.${key}`)).not.toMatch(/\p{Script=Hebrew}/u);
    }
    expect(runBlockerKey("something else")).toBeNull();
  });

  it("words the handover screen, in Hebrew, exactly as lib/handover-readiness writes it", () => {
    const heH = translator("he", "clients.handover");
    const text = (x: ReadinessText) => ("raw" in x ? x.raw : heH(x.key, x.values));
    const p = (over: Partial<ReadinessProcessInput>): ReadinessProcessInput => ({
      id: "p",
      code: "P1",
      title: "שכר",
      status: "ACTIVE",
      transitionStatus: "WITH_ANKORA",
      ownerId: "o",
      executor: null,
      hasApprovedProcedure: true,
      documentation: { score: 6, of: 6 },
      systems: [],
      ...over,
    });
    const cases = [
      [],
      [p({})],
      [p({}), p({ id: "q", code: "P2" })],
      [p({ transitionStatus: "WITH_CLIENT", executor: "גיא", hasApprovedProcedure: false, systems: [{ id: "s", name: "Mercury", accessStatus: "NO_ACCESS", permission: "תשלומים" }] })],
      [p({ transitionStatus: "IN_HANDOVER", runBlocker: "לא ירוץ: תהליך לפי מועד בלי מועד" }), p({ id: "q", systems: [{ id: "s", name: "A", accessStatus: "PENDING", permission: null }, { id: "t", name: "B", accessStatus: "NO_ACCESS", permission: null }] })],
    ];
    for (const input of cases) {
      const r = readinessOf(input);
      expect(text(readinessLineText(r))).toBe(readinessLine(r));
      for (const proc of r.processes) expect(proc.missingText.map(text)).toEqual(proc.missing);
    }
    for (const c of READINESS_CHECKS) expect(heH(`checks.${c.key}`)).toBe(c.label);
    for (const [k, v] of Object.entries(SYSTEM_ACCESS_STATUS_LABELS)) expect(heH(`accessStatus.${k}`)).toBe(v);
  });
});

describe("labels the screens look up by value", () => {
  const same = (path: string, labels: Record<string, string>) => {
    for (const [k, v] of Object.entries(labels)) {
      expect(heP(`${path}.${k}`), `${path}.${k}`).toBe(v);
      expect(enP(`${path}.${k}`)).toBeTruthy();
    }
  };

  it("say in Hebrew what lib/ says", () => {
    same("labels.triggers", TRIGGER_LABELS);
    same("labels.transitions", TRANSITION_LABELS);
    same("labels.stepModes", STEP_MODE_LABELS);
    same("labels.actionTags", ACTION_TAG_LABELS);
    same("labels.channels", CHANNEL_LABELS);
    same("labels.fields", FIELD_LABELS);
    same("labels.reviewReasons", REVIEW_REASON_LABELS);
    same("labels.checkStates", CHECK_STATE_LABELS);
    same("labels.strangerSeverity", STRANGER_SEVERITY_LABELS);
    same("labels.strangerAskWho", STRANGER_ASK_WHO_LABELS);
    same("labels.lessonStatus", LESSON_STATUS_LABELS);
    same("labels.businessCalendars", BUSINESS_CALENDAR_LABELS);
    same("labels.branchSources", BRANCH_SOURCE_LABELS);
    same("labels.sendModes", SEND_MODE_LABELS);
  });

  it("word the lines the card used to build in code", () => {
    for (const d of [{ score: 6, of: 6 }, { score: 3, of: 6 }]) {
      expect(d.score >= d.of ? heP("documentation.full") : heP("documentation.partial", { score: d.score, of: d.of })).toBe(documentationLine(d));
    }
    for (const days of [1, 7, 14, 30, 31, 5, 90]) expect(heP("panel.checkEvery", { days: String(days) })).toBe(checkEveryText(days));
    for (const day of [0, 3, -2]) expect(day >= 0 ? heP("visual.day", { day: String(day) }) : heP("visual.daysBefore", { days: String(-day) })).toBe(dayLabel(day));
  });

  it("word the stranger test line as lib/stranger-test does", () => {
    const line = (s: StrangerState | null) => {
      if (!s) return heP("stranger.notRun");
      const date = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(s.at));
      if (s.open === 0) return heP("stranger.passed", { date });
      const parts = [s.blockers ? heP("stranger.blockers", { count: s.blockers }) : null, heP("stranger.questions", { count: s.open })].filter(Boolean).join(", ");
      return heP("stranger.open", { parts, date });
    };
    const at = "2026-10-31T21:30:00.000Z";
    for (const s of [null, { at, open: 0, blockers: 0, answered: 3 }, { at, open: 1, blockers: 1, answered: 0 }, { at, open: 5, blockers: 2, answered: 0 }, { at, open: 2, blockers: 0, answered: 0 }]) {
      expect(line(s)).toBe(strangerLine(s));
    }
  });
});

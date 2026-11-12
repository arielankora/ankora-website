import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACTION_LABEL, ENTITY_TYPES, actionMessageKey, auditSearchWhere, classifyAction } from "../../app/(product)/app/(authenticated)/audit-log/labels";
import he from "../../messages/he.json";
import en from "../../messages/en.json";

/**
 * `recordAudit` writes a row; the audit screen decides how to show it. Nothing
 * connects the two. An action missing from ACTION_LABEL records perfectly and
 * then renders in the Hebrew log as a raw English string, and an entity type
 * missing from ENTITY_TYPES cannot be selected in the filter at all.
 *
 * Neither failure is visible from the code. Both are only visible by opening
 * the screen and reading it — which is how, in September 2026, we found
 * `mcp.oauth.granted` sitting unlabelled since Phase 15, and then fourteen
 * more actions and five entity types behind it, some from Phase 10.
 *
 * So the guard has to live in the suite rather than in whoever remembers. The
 * same reasoning, and the same shape, as tailwind-tokens.test.ts: scan the
 * source for the thing that must be registered, and fail on anything that is
 * not.
 */

/// Stops at the next key rather than at a newline: several call sites put
/// `action:` and `entityType:` on the same line, and a newline-only stop
/// swallowed the entity name as if it were an action.
const ACTION_IN_CALL = /action:\s*([\s\S]*?)(?:,?\s*(?:entityType|entityId|actorId|clientId|before|after|ip|userAgent):|\n)/;
const ENTITY_IN_CALL = /entityType:\s*"([^"]+)"/;

/// The audit helper itself declares `action: string` in its own parameter
/// type, which is not a call site.
const NOT_A_CALL_SITE = ["lib/app-auth/audit.ts"];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

type CallSite = { file: string; actions: string[]; entityType: string | null };

/// Every `recordAudit(...)` in the app, with the literal action strings it can
/// write. Two call sites choose their action with a ternary
/// (`tasks.ts`, `billing.ts`), so both branches are collected rather than
/// just the first — a label gap on the less common branch is still a gap.
function auditCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of [...sourceFiles("lib"), ...sourceFiles("app")]) {
    if (NOT_A_CALL_SITE.some((skip) => file.endsWith(skip))) continue;
    const src = readFileSync(file, "utf-8");
    for (const match of src.matchAll(/recordAudit\(/g)) {
      const segment = src.slice(match.index! + match[0].length, match.index! + match[0].length + 900);
      const actionExpr = segment.match(ACTION_IN_CALL)?.[1] ?? "";
      const actions = [...actionExpr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      sites.push({ file, actions, entityType: segment.match(ENTITY_IN_CALL)?.[1] ?? null });
    }
  }
  return sites;
}

describe("audit log registries", () => {
  // Cheap canary: if a refactor renames the helper or changes its call shape,
  // the scans below would silently pass on zero call sites and this suite
  // would become decorative.
  it("finds the audit call sites at all", () => {
    const sites = auditCallSites();
    expect(sites.length).toBeGreaterThan(40);
    expect(sites.flatMap((s) => s.actions).length).toBeGreaterThan(40);
  });

  it("every audited action has a Hebrew label", () => {
    const unlabelled = auditCallSites()
      .flatMap((site) => site.actions.map((action) => ({ action, file: site.file })))
      .filter(({ action }) => !(action in ACTION_LABEL))
      .map(({ action, file }) => `${action} (${file})`);

    expect(unlabelled).toEqual([]);
  });

  it("every audited entity type can be filtered for", () => {
    const missing = [
      ...new Set(
        auditCallSites()
          .map((site) => site.entityType)
          .filter((entity): entity is string => !!entity && !ENTITY_TYPES.includes(entity)),
      ),
    ];

    expect(missing).toEqual([]);
  });

  // ADR 0006: the screen reads each label from the dictionaries, under
  // auditLog.actions.<actionMessageKey(action)>, while ACTION_LABEL stays
  // the Hebrew the client file writes. Every action needs a line in both
  // languages, the Hebrew must be the same words, and no two actions may
  // fold into the same key.
  it("every labelled action has the same Hebrew and an English line in the dictionaries", () => {
    const heActions = he.auditLog.actions as Record<string, string>;
    const enActions = en.auditLog.actions as Record<string, string>;
    const keys = Object.keys(ACTION_LABEL).map(actionMessageKey);
    expect(new Set(keys).size).toBe(keys.length);
    const mismatched = Object.entries(ACTION_LABEL)
      .filter(([action, label]) => heActions[actionMessageKey(action)] !== label)
      .map(([action]) => action);
    expect(mismatched).toEqual([]);
    const noEnglish = Object.keys(ACTION_LABEL).filter((action) => !enActions[actionMessageKey(action)]);
    expect(noEnglish).toEqual([]);
    // And nothing in the dictionaries for an action that is not registered.
    expect(Object.keys(heActions).sort()).toEqual([...keys].sort());
    expect(Object.keys(enActions).sort()).toEqual([...keys].sort());
  });

  it("every tag kind is worded in both languages", () => {
    for (const action of [...Object.keys(ACTION_LABEL), "logout"]) {
      const { kind } = classifyAction(action);
      expect(he.auditLog.kinds[kind]).toBeTruthy();
      expect(en.auditLog.kinds[kind]).toBeTruthy();
    }
  });

  // The reverse direction. A label for an action nobody writes any more is
  // dead weight that makes the registry harder to trust, and usually means a
  // call site was deleted without cleaning up after it.
  it("has no label for an action that is never recorded", () => {
    const recorded = new Set(auditCallSites().flatMap((s) => s.actions));
    // Written by Auth.js's own sign-out path rather than by a recordAudit
    // call in this repo, so the scan above cannot see it.
    const recordedElsewhere = new Set(["logout"]);
    const orphans = Object.keys(ACTION_LABEL).filter((a) => !recorded.has(a) && !recordedElsewhere.has(a));

    expect(orphans).toEqual([]);
  });

  // classifyAction derives the row's coloured tag from the action string, so
  // a new naming convention can silently fall through to the generic "עריכה".
  // These are the six kinds the redesign specified; the assertions below pin
  // the ones where falling through would actively mislead an admin.
  it("tags access changes and failures distinctly, not as routine edits", () => {
    expect(classifyAction("login.failure").kind).toBe("failure");
    expect(classifyAction("login.success").kind).toBe("login");
    expect(classifyAction("user.logout_all_sessions").kind).toBe("login");
    expect(classifyAction("user.role_status_change").kind).toBe("access");
    expect(classifyAction("mcp.oauth.granted").kind).toBe("access");
    expect(classifyAction("mcp_grant.revoke").kind).toBe("access");
    expect(classifyAction("mcp_grant.revoke_all").kind).toBe("access");
    expect(classifyAction("important_date.delete").kind).toBe("delete");
    expect(classifyAction("important_date.create").kind).toBe("create");
    expect(classifyAction("time_entry.update").kind).toBe("edit");
    // Credentials vault: a reveal is not an edit, and a refused reveal or
    // a failed identity check is a failure.
    expect(classifyAction("credential.reveal").kind).toBe("reveal");
    expect(classifyAction("credential.reveal_denied").kind).toBe("failure");
    expect(classifyAction("credential.stepup_failed").kind).toBe("failure");
    expect(classifyAction("credential.create").kind).toBe("create");
    expect(classifyAction("credential.delete").kind).toBe("delete");
    expect(classifyAction("credential.exposure_report").kind).toBe("report");
  });
});

// Ariel, 26.9.2026: the audit search only matched the English action key.
describe("auditSearchWhere - what the audit search box looks in", () => {
  it("finds actions by their Hebrew label, not only by the English key", () => {
    const where = auditSearchWhere("יצירת משימה") as { OR: Record<string, unknown>[] };
    const byLabel = where.OR.find((c) => "action" in c && (c.action as { in?: string[] }).in);
    expect((byLabel?.action as { in: string[] }).in).toContain("task.create");
  });

  // ADR 0006: the English screen shows English labels, so they find rows too.
  it("finds actions by their English label, ignoring case", () => {
    const where = auditSearchWhere("task created") as { OR: Record<string, unknown>[] };
    const byLabel = where.OR.find((c) => "action" in c && (c.action as { in?: string[] }).in);
    expect((byLabel?.action as { in: string[] }).in).toContain("task.create");
  });

  it("looks in who did it, the client and the entity", () => {
    const where = auditSearchWhere("Hadas") as { OR: Record<string, unknown>[] };
    const keys = where.OR.map((c) => Object.keys(c)[0]);
    expect(keys).toEqual(expect.arrayContaining(["action", "actor", "client", "entityType", "entityId"]));
  });

  it("drops a leading # so the short id copied off the screen finds its row", () => {
    const where = auditSearchWhere("#z2o1de") as { OR: Record<string, unknown>[] };
    const byId = where.OR.find((c) => "entityId" in c);
    expect((byId?.entityId as { contains: string }).contains).toBe("z2o1de");
  });

  it("adds nothing for an empty search", () => {
    expect(auditSearchWhere("   ")).toEqual({});
  });
});

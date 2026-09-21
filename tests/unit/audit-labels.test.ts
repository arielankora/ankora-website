import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACTION_LABEL, ENTITY_TYPES, classifyAction } from "../../app/(product)/app/(authenticated)/audit-log/labels";

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
    expect(classifyAction("login.failure").label).toBe("כשלון");
    expect(classifyAction("login.success").label).toBe("התחברות");
    expect(classifyAction("user.logout_all_sessions").label).toBe("התחברות");
    expect(classifyAction("user.role_status_change").label).toBe("הרשאות");
    expect(classifyAction("mcp.oauth.granted").label).toBe("הרשאות");
    expect(classifyAction("mcp_grant.revoke").label).toBe("הרשאות");
    expect(classifyAction("mcp_grant.revoke_all").label).toBe("הרשאות");
    expect(classifyAction("important_date.delete").label).toBe("מחיקה");
    expect(classifyAction("important_date.create").label).toBe("יצירה");
    expect(classifyAction("time_entry.update").label).toBe("עריכה");
  });
});

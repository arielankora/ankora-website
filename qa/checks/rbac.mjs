// Level 3 - the permission matrix, first stage: every entry point is either
// guarded or on a list of reasons.
//
// The reserved slot, filled, and filled with the rule the code states about
// itself. lib/app-auth/permissions.ts says: "Every server-side entry point
// (route handler / server action) must call one of these - never rely on
// hiding a button in the UI." Nothing checked that. A comment that describes
// a rule is not the rule, and this repo has paid for that shape of mistake
// five times (see the 25.10.2026 entry in claude/qa-runs-browser-e2e.md).
//
// What an entry point is: every function exported from a file that starts
// with "use server", and every GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD
// exported from a route.ts under app/. Those are the only doors a browser or
// a stranger can knock on.
//
// What guarded means: the function's own body calls something in GUARDS, a
// session check (requireUser) or a credential check (authorizeCronRequest).
// It does not prove the guard is the *right* one, and it says so in its name:
// this is the first stage. It answers "did anybody check at all", which is
// the question a missing guard fails. It does not answer "may THIS role do
// THAT", which needs the role and the action in one place, and that is the
// runtime matrix, not written yet.
//
// By syntax tree, not by regular expression. A first draft used a regex and
// took the `{` of a return type, `Promise<{ ok: boolean }>`, for the start of
// the body, and reported fourteen actions that call requireUser on their
// first line as unguarded. A check that cries wolf gets deleted.
//
// Entry points that are public on purpose (login, password reset, a signing
// link, the health probe) are in PUBLIC with the reason each one is safe to
// be public. An entry that is unguarded and not listed is a blocker. A listed
// entry that is now guarded, or no longer exists, is minor: the list is a set
// of reasons, and a reason that outlived its code is how a list stops being
// read.

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import { finding } from "../lib/report.mjs";

const ROOTS = ["app"];
const HTTP_VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

/**
 * Calls that count as a guard.
 *
 * Session: requireUser, requireUserOrThrow, getCurrentUser, resolvePortalClient.
 * Credential on a machine route: authorizeCronRequest, resolveBlogWriter,
 * isRequestAuthorized (the blog admin cookie), openJsonRoute (session and body
 * limits for the passkey routes), plus assertCan/can for a permission checked
 * in the entry point itself.
 *
 * Adding a name here is a decision that every call to it really refuses.
 */
export const GUARDS = [
  "requireUser",
  "requireUserOrThrow",
  "getCurrentUser",
  "resolvePortalClient",
  "assertCan",
  "authorizeCronRequest",
  "resolveBlogWriter",
  "isRequestAuthorized",
  "openJsonRoute",
];

/**
 * Guards applied once to the whole file rather than inside each function.
 *
 * The MCP routes wrap their handler at module level,
 * `withMcpAuth(handler, verifyMcpBearerToken, { required: true })`, and export
 * the wrapped result. A file that does that guards every verb it exports, and
 * a file that stops doing it loses the credit.
 */
const FILE_GUARDS = ["withMcpAuth"];

/** Guards that check a named permission in the entry point itself, as opposed to a session only. */
const PERMISSION_GUARDS = new Set(["assertCan"]);

/**
 * Entry points that are public on purpose, keyed "path#name", with why.
 *
 * Each reason has to say what stops a stranger doing damage, because "it is
 * public" is the description and not the defence.
 *
 * @type {Record<string, string>}
 */
export const PUBLIC = {
  "app/(product)/agreements/sign/[token]/actions.ts#signWithLinkAction": "the token in the form is the only credential (the action's own header comment says so)",
  "app/(product)/agreements/upload/[token]/actions.ts#uploadSignedPdfAction": "the token in the form is the only credential (the action's own header comment says so)",
  "app/(product)/app/forgot-password/actions.ts#forgotPasswordAction": "pre-login by definition; the same answer whether or not the account exists (spec section 20)",
  "app/(product)/app/login-link/actions.ts#requestLoginLinkAction": "pre-login by definition; the message never says whether the address exists",
  "app/(product)/app/login-link/actions.ts#consumeLoginLinkAction": "the link token is the credential; the consume endpoint is rate limited per IP",
  "app/(product)/app/login/actions.ts#loginAction": "the login form itself; rate limited per IP, one generic error for every failure, and a right password yields a pending sign-in, not a session",
  "app/(product)/app/login/actions.ts#passkeyLoginVerifyAction": "the passkey assertion is the credential; the pending-login token alone grants nothing",
  "app/(product)/app/login/actions.ts#passkeyLoginOptionsAction": "pre-login by definition; a challenge reveals nothing",
  "app/(product)/app/login/actions.ts#enrollOptionsAction": "pre-session enrolment; gated by a pending-login record from a verified first factor",
  "app/(product)/app/login/actions.ts#enrollFinishAction": "pre-session enrolment; gated by a pending-login record from a verified first factor",
  "app/(product)/app/login/actions.ts#redeemDeviceCodeAction": "a short-lived single-use device code is the credential",
  "app/(product)/app/reset-password/actions.ts#resetPasswordAction": "the reset token is the credential",
  "app/(product)/upload/actions.ts#checkUploadCodeAction": "the upload code is the credential",
  "app/(product)/upload/actions.ts#uploadWithCodeAction": "the upload code is the credential",
  "app/api/admin/login/route.ts#POST": "the blog admin login; the password is compared with timingSafeEqual",
  "app/api/admin/logout/route.ts#POST": "clearing a cookie reveals and changes nothing",
  "app/api/contact/route.ts#POST": "the public contact form; rate limited, and the address and phone are validated",
  "app/api/health/route.ts#GET": "an uptime probe; says only that the app serves and which commit",
  "app/api/security-txt/route.ts#GET": "RFC 9116 security.txt is public by specification and static",
  "app/api/mcp/files/[ticket]/route.ts#GET": "the ticket in the URL is the credential; a malformed ticket is refused on its shape, and redeemDownloadTicket checks the rest",
  "app/api/mcp/files/[ticket]/route.ts#PUT": "the ticket in the URL is the credential; a malformed ticket is refused on its shape, and redeemDownloadTicket checks the rest",
  "app/api/mcp/files/[ticket]/route.ts#POST": "the ticket in the URL is the credential; a malformed ticket is refused on its shape, and redeemDownloadTicket checks the rest",
  "app/api/mcp/oauth/authorize/route.ts#GET": "the OAuth authorize endpoint; validates client_id and redirect_uri before it redirects anywhere, and the existing Auth.js login does the signing in",
  "app/api/mcp/oauth/metadata/authorization-server/route.ts#GET": "RFC 8414 metadata is public by specification",
  "app/api/mcp/oauth/metadata/authorization-server/route.ts#OPTIONS": "CORS preflight for public metadata",
  "app/api/mcp/oauth/metadata/protected-resource/portal/route.ts#GET": "RFC 9728 metadata is public by specification",
  "app/api/mcp/oauth/metadata/protected-resource/portal/route.ts#OPTIONS": "CORS preflight for public metadata",
  "app/api/mcp/oauth/metadata/protected-resource/route.ts#GET": "RFC 9728 metadata is public by specification",
  "app/api/mcp/oauth/metadata/protected-resource/route.ts#OPTIONS": "CORS preflight for public metadata",
  "app/api/mcp/oauth/register/route.ts#POST": "RFC 7591 dynamic client registration is open by specification; rate limited per IP",
  "app/api/mcp/oauth/token/route.ts#POST": "the OAuth token endpoint; the authorization code and its PKCE verifier are the credential",
};

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...(await walk(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const hasModifier = (node, kind) => !!node.modifiers?.some((m) => m.kind === kind);

/** The names a node's body calls, by identifier: `a()`, `await a()`, `x.a()` count as "a". */
function calledNames(node) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee)) names.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) names.add(callee.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/**
 * The entry points of one file, as a pure function over its text.
 *
 * @param {string} source
 * @param {{route: boolean}} kind - true for a route.ts, where only the HTTP
 *   verbs are entry points; false for a "use server" file, where every
 *   exported function is.
 * @returns {{name: string, guards: string[]}[]} one row per entry point, with
 *   the guards its own body calls (empty means unguarded). A file that is
 *   neither a route nor a "use server" file has no entry points.
 */
export function entryPoints(source, { route }) {
  const sf = ts.createSourceFile("f.ts", source, ts.ScriptTarget.Latest, true);
  const useServer =
    sf.statements.length > 0 &&
    ts.isExpressionStatement(sf.statements[0]) &&
    ts.isStringLiteral(sf.statements[0].expression) &&
    sf.statements[0].expression.text === "use server";
  if (!route && !useServer) return [];

  /** Every function in the file by local name, so `export { upload as PUT }` can be followed. */
  const locals = new Map();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) locals.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          locals.set(d.name.text, d.initializer);
        }
      }
    }
  }

  const fileGuards = [...calledNames(sf)].filter((n) => FILE_GUARDS.includes(n));

  const rows = [];
  const add = (exported, fn) => {
    if (route && !HTTP_VERBS.has(exported)) return;
    const found = fn ? [...calledNames(fn.body ?? fn)].filter((n) => GUARDS.includes(n)) : [];
    rows.push({ name: exported, guards: [...found, ...fileGuards] });
  };

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      add(st.name.text, st);
    } else if (ts.isVariableStatement(st) && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && locals.has(d.name.text)) add(d.name.text, locals.get(d.name.text));
      }
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause) && !st.moduleSpecifier) {
      for (const el of st.exportClause.elements) {
        const local = (el.propertyName ?? el.name).text;
        if (locals.has(local)) add(el.name.text, locals.get(local));
      }
    }
  }
  return rows;
}

/** Everything under app/ that is a door, with its guards. */
export async function inventory(roots = ROOTS) {
  const files = [];
  for (const root of roots) {
    try {
      files.push(...(await walk(root)));
    } catch {
      // A root that does not exist is not a finding about this rule.
    }
  }
  const rows = [];
  for (const file of new Set(files)) {
    const path = relative(".", file).split("\\").join("/");
    let src;
    try {
      src = await readFile(path, "utf-8");
    } catch {
      continue;
    }
    const route = /(^|\/)route\.ts$/.test(path);
    for (const row of entryPoints(src, { route })) rows.push({ id: `${path}#${row.name}`, ...row });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

/** The rule, over an inventory and a list of public reasons. */
export function judge(rows, publicList = PUBLIC) {
  const unlisted = rows.filter((r) => r.guards.length === 0 && !(r.id in publicList));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stale = Object.keys(publicList).filter((id) => !byId.has(id) || byId.get(id).guards.length > 0);
  return { unlisted, stale };
}

export async function permissionMatrix() {
  const rows = await inventory();
  const { unlisted, stale } = judge(rows);
  const out = [];

  if (unlisted.length > 0) {
    out.push(
      finding(
        "blocker",
        `${unlisted.length} entry point(s) with no guard and no reason to be public`,
        [
          "Every server action and route handler is a door a stranger can knock on, and",
          "lib/app-auth/permissions.ts says each one must check who is knocking. These call",
          `none of: ${GUARDS.join(", ")}.`,
          "",
          "Either call a guard in the function itself, or, if it is public on purpose, add it",
          "to PUBLIC in qa/checks/rbac.mjs with what stops a stranger doing damage.",
          "",
          ...unlisted.map((r) => r.id),
        ].join("\n"),
      ),
    );
  }

  if (stale.length > 0) {
    out.push(
      finding(
        "minor",
        `${stale.length} entry(ies) in the public list that no longer apply`,
        [
          "Each is either gone or now calls a guard. A reason that outlived its code is how a",
          "list stops being read. Remove them from PUBLIC in qa/checks/rbac.mjs.",
          "",
          ...stale,
        ].join("\n"),
      ),
    );
  }

  const guarded = rows.filter((r) => r.guards.length > 0).length;
  const permissionChecked = rows.filter((r) => r.guards.some((g) => PERMISSION_GUARDS.has(g))).length;
  out.push(
    finding(
      "info",
      `${rows.length} entry points: ${guarded} guarded, ${rows.length - guarded} without a guard of their own`,
      [
        `${permissionChecked} check a named permission in the entry point itself; the rest check the session and`,
        "leave the role to the domain function they call. This stage proves somebody checked;",
        "it does not prove they checked the right thing. That is the runtime matrix.",
      ].join("\n"),
    ),
  );
  return out;
}

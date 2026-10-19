import "server-only";
import { prisma } from "@/lib/prisma";

// What a proposal names, found in the client's file (spec 3.5 to 3.11).
//
// Claude never sees an id: it names a contact, a system, an entity or a
// process as it was said. The names are resolved here, inside the client
// only, when the proposal is approved: by then an item proposed in the
// same batch may already be in the file. A name that is nobody, or more
// than one thing, links to nothing; the card said so when it arrived, and
// the text fields (approverText, externalPartyText) still carry the words.

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

function names(v: unknown): string[] {
  if (typeof v === "string") return v.trim() ? [norm(v)] : [];
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && !!x.trim()).map(norm))];
}

const eq = (name: string) => ({ equals: name, mode: "insensitive" as const });

/// One row or nothing: a name that matches two is not a match.
function only<T>(rows: T[]): T | null {
  return rows.length === 1 ? rows[0] : null;
}

export async function contactByName(clientId: string, name: string): Promise<string | null> {
  const rows = await prisma.clientContact.findMany({
    where: { clientId, deletedAt: null, OR: [{ person: { name: eq(name) } }, { role: eq(name) }] },
    select: { id: true },
    take: 2,
  });
  return only(rows)?.id ?? null;
}

export async function organizationByName(clientId: string, name: string): Promise<string | null> {
  const rows = await prisma.clientOrganization.findMany({ where: { clientId, deletedAt: null, organization: { name: eq(name) } }, select: { id: true }, take: 2 });
  return only(rows)?.id ?? null;
}

export async function systemByName(clientId: string, name: string): Promise<string | null> {
  const rows = await prisma.systemAccess.findMany({ where: { clientId, deletedAt: null, systemName: eq(name) }, select: { id: true }, take: 2 });
  return only(rows)?.id ?? null;
}

export async function entityByName(clientId: string, name: string): Promise<string | null> {
  const rows = await prisma.clientEntity.findMany({ where: { clientId, deletedAt: null, name: eq(name) }, select: { id: true }, take: 2 });
  return only(rows)?.id ?? null;
}

/// By its code ("P3") or its title.
export async function processByName(clientId: string, name: string): Promise<string | null> {
  const code = /^P\d+$/i.test(name) ? name.toUpperCase() : null;
  const rows = await prisma.process.findMany({
    where: { clientId, deletedAt: null, ...(code ? { code } : { title: eq(name) }) },
    select: { id: true },
    take: 2,
  });
  return only(rows)?.id ?? null;
}

export async function policyByName(clientId: string, name: string): Promise<string | null> {
  const rows = await prisma.clientPolicy.findMany({ where: { clientId, deletedAt: null, status: { not: "RETIRED" }, title: eq(name) }, select: { id: true }, take: 2 });
  return only(rows)?.id ?? null;
}

async function many(clientId: string, list: string[], find: (clientId: string, name: string) => Promise<string | null>) {
  const found: string[] = [];
  const missing: string[] = [];
  for (const n of list) {
    const id = await find(clientId, n);
    if (id) found.push(id);
    else missing.push(n);
  }
  return { ids: [...new Set(found)], missing };
}

export type ResolvedLinks = {
  /// The fields the file's own functions take, ready to spread in.
  fields: Record<string, unknown>;
  /// Per process step, the systems it uses.
  stepSystemIds: string[][];
  /// What was named and is not in the file, as "label: name".
  missing: string[];
};

/// The name fields a proposal of this kind may carry, and where each goes.
export async function resolveLinks(clientId: string, target: string, payload: Record<string, unknown>): Promise<ResolvedLinks> {
  const fields: Record<string, unknown> = {};
  const missing: string[] = [];
  const one = async (key: string, label: string, find: (c: string, n: string) => Promise<string | null>, to: string) => {
    const [n] = names(payload[key]);
    if (!n) return;
    const id = await find(clientId, n);
    if (id) fields[to] = id;
    else missing.push(`${label}: ${n}`);
  };
  const list = async (key: string, label: string, find: (c: string, n: string) => Promise<string | null>, to: string) => {
    const r = await many(clientId, names(payload[key]), find);
    if (r.ids.length) fields[to] = r.ids;
    missing.push(...r.missing.map((n) => `${label}: ${n}`));
  };

  if (target === "CONTACT" || target === "SYSTEM" || target === "REQUEST_TYPE" || target === "PROCESS") await one("entityName", "ישות", entityByName, "entityId");
  if (target === "FACT") {
    const [n] = names(payload.subjectName);
    if (n) {
      const contact = await contactByName(clientId, n);
      const org = contact ? null : await organizationByName(clientId, n);
      if (contact) fields.subjectContactId = contact;
      else if (org) fields.subjectOrgId = org;
      else missing.push(`של מי ההעדפה: ${n}`);
    }
  }
  if (target === "REQUEST_TYPE") {
    await list("routeToNames", "למי מפנים", contactByName, "routeToContactIds");
    await one("processName", "תהליך", processByName, "processId");
  }
  const stepSystemIds: string[][] = [];
  if (target === "PROCESS") {
    await list("externalPartyNames", "גורם חיצוני", contactByName, "externalPartyContactIds");
    await list("systemNames", "מערכת", systemByName, "requiredSystemIds");
    await list("approvalPolicyTitles", "כלל אישור", policyByName, "approvalPolicyIds");
    // An approver at Ankora signs in the product; otherwise a contact.
    const [approver] = names(payload.approverName);
    if (approver) {
      const users = await prisma.user.findMany({ where: { deletedAt: null, status: "ACTIVE", role: { not: "CLIENT_USER" }, name: eq(approver) }, select: { id: true }, take: 2 });
      const user = only(users);
      const contact = user ? null : await contactByName(clientId, approver);
      if (user) fields.approverUserId = user.id;
      else if (contact) fields.approverContactId = contact;
      else missing.push(`מאשר: ${approver}`);
    }
    const steps = Array.isArray(payload.steps) ? (payload.steps as Record<string, unknown>[]) : [];
    for (const [i, st] of steps.entries()) {
      const r = await many(clientId, names(st?.systemNames), systemByName);
      stepSystemIds.push(r.ids);
      missing.push(...r.missing.map((n) => `שלב ${i + 1}, מערכת: ${n}`));
    }
  }
  return { fields, stepSystemIds, missing };
}

/// The name fields, out of the payload the file's functions get.
export const LINK_KEYS = ["entityName", "subjectName", "routeToNames", "processName", "externalPartyNames", "systemNames", "approvalPolicyTitles", "approverName"] as const;

export function withoutLinkNames<T extends Record<string, unknown>>(v: T): T {
  const out = { ...v } as Record<string, unknown>;
  for (const k of LINK_KEYS) delete out[k];
  return out as T;
}

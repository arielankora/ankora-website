import "server-only";
import type { User } from "@prisma/client";
import { assertCan, can } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { listUsers } from "@/lib/app-domain/users";
import { describeResolveFailure, resolveByName, normalizeName } from "@/lib/mcp/resolve";

// Phase 14 (MCP server writes, docs/adr/0005): turning the names a model
// says into the ids the domain layer wants.
//
// Every function here resolves against what THIS ACTOR may see - never a
// global list - so the lookup itself can never disclose a client or a
// colleague the caller has no right to know about. That is why each takes
// `actor` rather than a pre-fetched list.
//
// The matching rules live in lib/mcp/resolve.ts, which is pure and unit
// tested; this module only supplies the candidates and the permission
// checks. It stays thin on purpose.

/// The shapes this module reads, declared structurally rather than
/// imported from Prisma's generated types. Callback parameters are
/// checked bivariantly, so these accept the richer real rows while
/// keeping the file honest about the handful of fields it touches - and
/// they keep it typechecking in an environment where `prisma generate`
/// has not run (see tests/unit/reports.test.ts on that limitation).
type Named = { id: string; name: string };
type TeamMember = Named & { email: string };
type CategoryRow = Named & { active: boolean; visibility: string; clientId: string | null };
type UserRow = TeamMember & { role: string; status: string; deletedAt: Date | null };

export type Lookup<T> = { ok: true; value: T } | { ok: false; message: string };

/// Resolves a client name against the clients this actor may log time
/// against. Admins see every active client; an employee sees only their
/// assigned ones, so the same name can resolve for one user and be
/// refused for another - which is correct.
export async function lookupClient(actor: User, name: string): Promise<Lookup<Named>> {
  const clients = await listAccessibleClients(actor);
  const candidates: Named[] = clients.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }));
  const result = resolveByName(name, candidates);
  if (result.status === "ok") return { ok: true, value: result.match };
  return { ok: false, message: describeResolveFailure(result, "client", candidates) };
}

/// Resolves a category name, scoped to one client.
///
/// A CLIENT-visibility category belongs to exactly one client and
/// `assertActiveTargets` in lib/app-domain/time-entries.ts rejects it for
/// any other, so filtering here means the model gets a useful "which of
/// these" message instead of a thrown error two calls later.
export async function lookupCategory(
  actor: User,
  clientId: string,
  name: string
): Promise<Lookup<Named>> {
  const all = await listCategories();
  const usable = all.filter((c: CategoryRow) => c.active && (c.visibility === "GLOBAL" || c.clientId === clientId));
  const candidates: Named[] = usable.map((c: CategoryRow) => ({ id: c.id, name: c.name }));
  const result = resolveByName(name, candidates);
  if (result.status === "ok") return { ok: true, value: result.match };
  return { ok: false, message: describeResolveFailure(result, "category", candidates) };
}

/// The categories usable for one client, for the list tool and for error
/// messages. Same filter as lookupCategory, so what a model is shown is
/// exactly what it may then name.
export async function usableCategories(clientId: string) {
  const all = await listCategories();
  return all
    .filter((c: CategoryRow) => c.active && (c.visibility === "GLOBAL" || c.clientId === clientId))
    .map((c: CategoryRow) => ({
      id: c.id,
      name: c.name,
      scope: c.visibility === "GLOBAL" ? "all clients" : "this client",
    }));
}

/// Whether this actor may see other people's time at all.
///
/// `time_entry.edit_others` is not invented here: it is the permission the
/// admin screen (app/(product)/app/(authenticated)/time-entries/page.tsx)
/// and the CSV export route (app/api/time-entries/export/route.ts) both
/// already gate this exact data on. Using anything else would create a
/// second, diverging answer to the same question.
export function canSeeOthersTime(actor: User): boolean {
  return can(actor.role, "time_entry.edit_others");
}

/// Resolves a teammate by name or email, for the admin-only team tools.
///
/// Asserts the permission itself rather than trusting the caller: listing
/// colleagues is a disclosure in its own right, so it must not be
/// reachable even by a mistake in a tool's own gating.
export async function lookupTeamMember(
  actor: User,
  nameOrEmail: string
): Promise<Lookup<TeamMember>> {
  assertCan(actor.role, "time_entry.edit_others");

  const users = await listUsers();
  const active: UserRow[] = users.filter((u: UserRow) => !u.deletedAt && u.status === "ACTIVE");

  // An exact email match wins outright - it is unambiguous by definition,
  // and two people can share a first name far more easily than an address.
  const q = normalizeName(nameOrEmail);
  const byEmail = active.find((u: UserRow) => normalizeName(u.email) === q);
  if (byEmail) return { ok: true, value: { id: byEmail.id, name: byEmail.name, email: byEmail.email } };

  const candidates: TeamMember[] = active.map((u: UserRow) => ({ id: u.id, name: u.name, email: u.email }));
  const result = resolveByName(nameOrEmail, candidates);
  if (result.status === "ok") return { ok: true, value: result.match };
  return { ok: false, message: describeResolveFailure(result, "team member", candidates) };
}

/// The team roster for the admin-only list tool. Same permission, same
/// reason.
export async function teamMembers(actor: User) {
  assertCan(actor.role, "time_entry.edit_others");
  const users = await listUsers();
  return users
    .filter((u: UserRow) => !u.deletedAt && u.status === "ACTIVE")
    .map((u: UserRow) => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
}

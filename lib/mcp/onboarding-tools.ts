import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText, toMcpToolError } from "@/lib/mcp/errors";
import { describeResolveFailure, resolveByName } from "@/lib/mcp/resolve";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { FIELD_NOTES_SENTENCE, withFieldNotes } from "@/lib/mcp/field-notes";
import { CLIENT_ONBOARDING_NOTES } from "@/lib/mcp/tool-field-notes";
import { appBaseUrl } from "@/lib/email-templates";
import { appUrl } from "@/lib/approval-links";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import { AI_EXCLUDED_TOOL_MESSAGE } from "@/lib/ai-exclusion";
import { listStaffForAssignment } from "@/lib/app-domain/clients";
import {
  addOnboardingContact,
  addOnboardingDomain,
  addOnboardingPartner,
  addOnboardingRule,
  addOnboardingSource,
  confirmNoSpecialRules,
  listOnboarding,
  onboardingState,
  setOnboardingChannel,
  setOnboardingTeam,
  startClientOnboarding,
  type OnboardingState,
} from "@/lib/app-domain/client-onboarding";
import type { SourceRef } from "@/lib/knowledge-sources";
import type { User } from "@prisma/client";

// New-client wizard (26.11.2026, Ariel): a client being set up is open to
// Claude through these three tools, so a setup can be continued from a
// conversation (an email, a meeting, a contract read with the user). It
// stays out of every other tool, the extraction and the agents until a
// person activates it on the summary screen; no tool here activates.

const setupUrl = (clientId: string, step?: number | "summary") => appUrl(appBaseUrl(), `/app/clients/${clientId}/setup${step ? `?step=${step}` : ""}`);

/// What Claude reads of a setup. Contact details are not sent, as in the
/// client file for Claude: only whether each contact has an email and a
/// mobile, which is what the setup needs to know.
function forClaude(s: OnboardingState) {
  return {
    client: s.name,
    kind: s.kind,
    step: s.step,
    domains: s.domains.map((d) => d.domain),
    partners: s.partners.map((p) => ({ name: p.name, domains: p.domains, role: p.role, source: p.source ?? undefined })),
    preferredChannel: s.preferredChannel,
    contacts: s.contacts.map((c) => ({
      name: c.name,
      role: c.role,
      hasEmail: c.emails.length > 0,
      hasPhone: c.phones.length > 0,
      isPrimary: c.isPrimary,
      isDecisionMaker: c.isDecisionMaker,
      source: c.source ?? undefined,
    })),
    rules: s.rules.map((r) => ({ kind: r.kind, title: r.title, statement: r.statement, status: r.status, source: r.source ?? undefined })),
    noSpecialRules: s.noSpecialRules,
    accountManager: s.accountManager?.name ?? null,
    backupManager: s.backupManager?.name ?? null,
    sources: s.sources.map((x) => ({ code: x.code, title: x.title })),
    missing: s.missing.map((m) => ({ step: m.step, text: m.text })),
    ready: s.ready,
    url: setupUrl(s.id, s.ready ? "summary" : s.step),
  };
}

type Found = { ok: true; id: string; name: string } | { ok: false; message: string };

/// A client being set up, by name. Only these: an active client is not
/// set up again, and is updated through the file's own tools.
async function findSetup(actor: User, name: string): Promise<Found> {
  assertCan(actor.role, "client.manage");
  const setups = await prisma.client.findMany({ where: { status: "ONBOARDING", deletedAt: null }, select: { id: true, name: true, aiExcluded: true } });
  const result = resolveByName(name, setups.filter((c) => !c.aiExcluded));
  if (result.status === "ok") return { ok: true, id: result.match.id, name: result.match.name };
  const marked = setups.filter((c) => c.aiExcluded);
  if (marked.length > 0 && resolveByName(name, marked).status === "ok") return { ok: false, message: AI_EXCLUDED_TOOL_MESSAGE };
  return { ok: false, message: describeResolveFailure(result, "client being set up", setups.filter((c) => !c.aiExcluded)) };
}

const SOURCE = z
  .object({
    sourceCode: z.string().optional().describe('A source already in the client\'s register ("S2"), from get_client_onboarding\'s `sources`.'),
    newSource: z
      .object({
        kind: z.enum(["EMAIL", "TRANSCRIPT", "CLIENT_DOCUMENT", "PERSON"]),
        title: z.string().min(1).describe("What it is, as a person would find it again: the email's subject and date, the meeting's title."),
        occurredAt: z.string().optional().describe("YYYY-MM-DD"),
      })
      .optional()
      .describe("Where what you add came from, when it is not in the register yet."),
  })
  .optional();

type SourceArg = z.infer<typeof SOURCE>;

export function registerOnboardingTools(server: McpServer): void {
  server.registerTool(
    "start_client_onboarding",
    {
      title: "Open a new client, in setup",
      description:
        'Opens a new client in Ankora, in setup ("בהקמה"): created, but not seen by the extraction, the agents, WhatsApp and call matching or the timer until a person activates it on the setup\'s summary screen. Pass its name, whether it is a business or a private person, and `aiExcluded`: whether nothing of this client may pass through AI. Ask the user for aiExcluded every time and pass their answer; never assume it. Then fill the setup with update_client_onboarding. For managers only. ' +
        FIELD_NOTES_SENTENCE,
      inputSchema: z.object({
        name: z.string().min(1),
        kind: z.enum(["BUSINESS", "PRIVATE"]),
        aiExcluded: z.boolean(),
        industry: z.string().optional().describe("In a few words what they do."),
        communicationLocale: z.enum(["he", "en"]).optional().describe("The language Ankora writes to them in. Hebrew when not said."),
      }),
      annotations: TOOL_ANNOTATIONS.start_client_onboarding,
    },
    async (args: { name: string; kind: "BUSINESS" | "PRIVATE"; aiExcluded: boolean; industry?: string; communicationLocale?: "he" | "en" }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await startClientOnboarding(actor, args);
        if (client.aiExcluded) {
          return toolJson({ created: true, client: client.name, url: setupUrl(client.id, 2), note: AI_EXCLUDED_TOOL_MESSAGE });
        }
        return toolJson(withFieldNotes({ created: true, ...forClaude(await onboardingState(actor, client.id)) }, CLIENT_ONBOARDING_NOTES));
      } catch (err) {
        console.error("[mcp] start_client_onboarding failed", err);
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "get_client_onboarding",
    {
      title: "Where a new client's setup stands",
      description:
        "Where the setup of a new client stands: what was filled in each of its four steps, what is still missing before it can be activated, and the link to the setup screen. Without `client`, lists every client being set up. A client being set up is in no other tool until a person activates it. For managers only. " +
        FIELD_NOTES_SENTENCE,
      inputSchema: z.object({ client: z.string().optional().describe("The client's name. Leave out to list every setup.") }),
      annotations: TOOL_ANNOTATIONS.get_client_onboarding,
    },
    async (args: { client?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        if (!args.client) {
          const setups = (await listOnboarding(actor)).filter((s) => !s.aiExcluded);
          return toolJson(
            withFieldNotes(
              { setups: setups.map((s) => ({ client: s.name, kind: s.kind, step: s.step, missing: s.missing.map((m) => ({ step: m.step, text: m.text })), ready: s.ready, url: setupUrl(s.id, s.ready ? "summary" : s.step) })) },
              CLIENT_ONBOARDING_NOTES,
            ),
          );
        }
        const found = await findSetup(actor, args.client);
        if (!found.ok) return toolText(found.message);
        return toolJson(withFieldNotes(forClaude(await onboardingState(actor, found.id)), CLIENT_ONBOARDING_NOTES));
      } catch (err) {
        console.error("[mcp] get_client_onboarding failed", err);
        return toolFailure(err);
      }
    },
  );

  server.registerTool(
    "update_client_onboarding",
    {
      title: "Fill in a new client's setup",
      description:
        "Adds to the setup of a client being set up (get_client_onboarding): its domains, partners with their domain, contacts with email and mobile, rules about information, the preferred channel, the account manager and backup, or that it has no rules of its own. Cite where it came from with `source`; without it, the setup itself is cited. Only what the user gave you or a source says, never a guess. Each item is saved or refused on its own. It does not activate the client: a person does, on the setup's summary screen. " +
        FIELD_NOTES_SENTENCE,
      inputSchema: z.object({
        client: z.string().describe("The client's name, as get_client_onboarding gives it."),
        source: SOURCE,
        domains: z.array(z.string()).optional().describe("The client's own email domains (example.co.il). Never a public mail service."),
        partners: z.array(z.object({ name: z.string(), domain: z.string().optional(), role: z.string().optional() })).optional().describe("Firms that work with the client: accountant, lawyer, suppliers."),
        contacts: z
          .array(
            z.object({
              name: z.string().optional(),
              role: z.string().optional(),
              email: z.string().optional(),
              phone: z.string().optional(),
              isDecisionMaker: z.boolean().optional(),
              isPrimary: z.boolean().optional(),
            }),
          )
          .optional(),
        rules: z.array(z.object({ kind: z.enum(["DATA_HANDLING", "DISCLOSURE"]), title: z.string(), statement: z.string() })).optional().describe("DATA_HANDLING: what may not enter the file. DISCLOSURE: what is not told to whom. Saved as proposed, for a manager to approve."),
        noSpecialRules: z.boolean().optional().describe("true only when the user said the client has no rules of its own."),
        preferredChannel: z.enum(["WHATSAPP", "EMAIL", "PHONE"]).optional(),
        whatsappNumber: z.string().optional(),
        accountManager: z.string().optional().describe("The Ankora person responsible, by name."),
        backupManager: z.string().optional().describe("Who stands in for them, by name. Someone else."),
      }),
      annotations: TOOL_ANNOTATIONS.update_client_onboarding,
    },
    async (
      args: {
        client: string;
        source?: SourceArg;
        domains?: string[];
        partners?: { name: string; domain?: string; role?: string }[];
        contacts?: { name?: string; role?: string; email?: string; phone?: string; isDecisionMaker?: boolean; isPrimary?: boolean }[];
        rules?: { kind: "DATA_HANDLING" | "DISCLOSURE"; title: string; statement: string }[];
        noSpecialRules?: boolean;
        preferredChannel?: "WHATSAPP" | "EMAIL" | "PHONE";
        whatsappNumber?: string;
        accountManager?: string;
        backupManager?: string;
      },
      ctx: ServerContext,
    ) => {
      try {
        const actor = actorOf(ctx);
        const found = await findSetup(actor, args.client);
        if (!found.ok) return toolText(found.message);
        const clientId = found.id;

        let sources: SourceRef[] | undefined;
        if (args.source?.sourceCode) sources = [{ code: args.source.sourceCode.trim() }];
        else if (args.source?.newSource) {
          const s = args.source.newSource;
          const row = await addOnboardingSource(actor, clientId, { kind: s.kind, title: s.title, occurredAt: s.occurredAt ? new Date(`${s.occurredAt}T12:00:00Z`) : null });
          sources = [{ code: row.code }];
        }

        const errors: { item: string; error: string }[] = [];
        const attempt = async (item: string, write: () => Promise<unknown>) => {
          try {
            await write();
          } catch (err) {
            errors.push({ item, error: toMcpToolError(err).message });
          }
        };

        for (const d of args.domains ?? []) await attempt(`domain ${d}`, () => addOnboardingDomain(actor, clientId, d));
        for (const p of args.partners ?? []) await attempt(`partner ${p.name}`, () => addOnboardingPartner(actor, clientId, { name: p.name, domain: p.domain ?? null, role: p.role ?? null, sources }));
        for (const c of args.contacts ?? []) {
          await attempt(`contact ${c.name ?? c.role ?? ""}`, () =>
            addOnboardingContact(actor, clientId, {
              name: c.name ?? null,
              role: c.role ?? null,
              emails: c.email ? [c.email] : [],
              phones: c.phone ? [c.phone] : [],
              isDecisionMaker: c.isDecisionMaker,
              isPrimary: c.isPrimary,
              sources,
            }),
          );
        }
        for (const r of args.rules ?? []) await attempt(`rule ${r.title}`, () => addOnboardingRule(actor, clientId, { ...r, sources }));
        if (args.noSpecialRules !== undefined) await attempt("noSpecialRules", () => confirmNoSpecialRules(actor, clientId, args.noSpecialRules!));
        if (args.preferredChannel || args.whatsappNumber) {
          const current = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { preferredChannel: true } });
          await attempt("preferredChannel", () =>
            setOnboardingChannel(actor, clientId, { preferredChannel: args.preferredChannel ?? current.preferredChannel, whatsappNumber: args.whatsappNumber }),
          );
        }
        if (args.accountManager || args.backupManager) {
          const staff = await listStaffForAssignment();
          const pick = (name: string | undefined) => {
            if (!name) return { ok: true as const, id: undefined };
            const r = resolveByName(name, staff);
            return r.status === "ok" ? { ok: true as const, id: r.match.id } : { ok: false as const, message: describeResolveFailure(r, "Ankora person", staff) };
          };
          const manager = pick(args.accountManager);
          const backup = pick(args.backupManager);
          if (!manager.ok) errors.push({ item: "accountManager", error: manager.message });
          if (!backup.ok) errors.push({ item: "backupManager", error: backup.message });
          if (manager.ok && backup.ok) {
            const current = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { accountManagerId: true, backupManagerId: true } });
            await attempt("team", () =>
              setOnboardingTeam(actor, clientId, { accountManagerId: manager.id ?? current.accountManagerId, backupManagerId: backup.id ?? current.backupManagerId }),
            );
          }
        }

        const state = forClaude(await onboardingState(actor, clientId));
        return toolJson(withFieldNotes({ ...state, ...(errors.length ? { errors } : {}) }, CLIENT_ONBOARDING_NOTES));
      } catch (err) {
        console.error("[mcp] update_client_onboarding failed", err);
        return toolFailure(err);
      }
    },
  );
}

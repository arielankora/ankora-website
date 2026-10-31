// What propose_knowledge publishes in tools/list, built from the same zod
// schemas the server validates each item with (lib/knowledge-proposals.ts
// PAYLOADS). 31.10.2026, RIMED: the tool published `payload` as an open
// object, so a client saw none of its fields, and an item with a topic
// outside the list (FACT.topic) was dropped for a value it had no way of
// knowing. Now every field and every closed list reaches the client, and
// there is one definition of each: change PAYLOADS and the published schema
// follows.
//
// Only what is published changes. Runtime validation of the call stays the
// lenient one (payload as any object), so a bad item is still dropped on
// its own with its path (items[3].payload.topic), and never fails the whole
// batch.

import { z } from "zod";
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { PAYLOADS, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { ACTION_TAGS, CHANNELS } from "@/lib/process-rules";

type Json = Record<string, unknown>;

export const PROPOSAL_TARGETS = Object.keys(PAYLOADS) as ProposalTargetLike[];

/// Fields the server reads but a client never sends, or sends elsewhere.
const NOT_PUBLISHED: Partial<Record<ProposalTargetLike, string[]>> & { all: string[] } = {
  // On the item as `status` (still accepted in the payload, for old clients).
  all: ["knowledgeStatus"],
  // The server records the version the text was written against.
  NARRATIVE: ["baseVersion"],
};

/// What each target's payload is for, and the rules the schema cannot say.
/// Shown as the description of that payload in the published schema.
const PAYLOAD_NOTES: Record<ProposalTargetLike, string> = {
  FACT: "A fact about the client. TEMPORARY needs validUntil or validUntilEvent; ONE_OFF_DECISION needs decidedAt; PREFERENCE takes subjectName (whose preference: a contact or firm in the file, by name). Never an action item: that is a TASK.",
  CONTACT: "A person. Needs name or role. entityName: the client's legal entity they work with.",
  ORGANIZATION: "A supplier, provider, advisor or investor. monthlyCostMinor in agorot or cents. Its name never changes on SUPERSEDE.",
  SYSTEM: "A system the client uses. billingCostMinor in agorot or cents; cardLast4 is the last four digits only, never more; invoiceTo: where the invoice arrives.",
  REQUEST_TYPE: "What comes in, from whom, and how it is answered. routeToNames: the contacts it goes to; processName: the process it sets off (P3 or title).",
  POLICY:
    "A rule the client set. Enters as proposed and binds once a manager approves it. THRESHOLD and APPROVAL_REQUIRED take interimStatement (and interimParams): the careful rule until approval. params only when the rule says something the server can check; keys a kind does not take are ignored.",
  ENTITY: "A legal entity of the client. parentName: an entity already in the file.",
  NARRATIVE: "One of the file's free texts. body is the WHOLE new text and replaces the current one; cite sources inside it as [S1 08:13]. No status.",
  PROCESS:
    "Something that recurs (a one-time project is a TASK). Enters as a draft; a manager approves the procedure. notApplicableFields only when it is clear a documentation field does not apply. steps when the procedure was described.",
  DOMAIN: "An email domain of the client (CLIENT) or of a supplier (PARTNER, with organizationName). No status.",
  TASK:
    "Something someone has to DO (a document to send, a call to set up), as an action, never a fact or a question. Without dueDate it is due in 3 business days. Read by everyone on the client: nothing sensitive. Never enters the file. No status, ownerName or clientVisible.",
  DATE:
    "A date of the client's own (payday, deadline, departure). date for ONCE and ANNUAL, dayOfMonth for MONTHLY (intervalMonths 2, 3, 4 or 6), weekday for WEEKLY (0 Sunday). Recurring work is a PROCESS with its DATE. One on the same day as a date in the file, under almost the same title, comes back in possibleMatches: if it is the same, leave it out. No status.",
};

/// POLICY params, as lib/policy-params.ts reads them, with the lists it
/// filters by. Names stand for ids: the server resolves them.
const PolicyParamsPublished = z
  .object({
    amountMinor: z.number().int().nonnegative().optional().describe("THRESHOLD: above this a person approves, in agorot or cents."),
    currency: z.string().optional().describe("THRESHOLD: three letters, such as ILS."),
    appliesToTags: z.array(z.enum(ACTION_TAGS)).optional().describe("The step tags the rule is about."),
    leadBusinessDays: z.number().int().min(1).max(60).optional().describe("TIMING: business days before the date."),
    channels: z.array(z.enum(CHANNELS)).optional().describe("COMMUNICATION: the channels a client message may go through."),
    invoiceTo: z.array(z.string()).optional().describe("COMMUNICATION: addresses or domains invoices must arrive at."),
    mustInclude: z.string().optional().describe("REQUIRED_STEP: words a step must contain."),
    entityName: z.string().optional().describe("A rule of one entity, by name."),
    entityNames: z.array(z.string()).optional().describe("SEPARATION: the entities kept apart, by name."),
  })
  .describe("What the server can check. Each kind reads only its keys.");

const CONVERSION = { target: "draft-2020-12" as const, io: "input" as const, unrepresentable: "any" as const };

/// `X | null` as just X: the client never needs to send null, and the
/// enum stays at the top where it is read.
function dropNull(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropNull);
  if (!node || typeof node !== "object") return node;
  const o = node as Json;
  if (Array.isArray(o.anyOf)) {
    const rest = (o.anyOf as Json[]).filter((s) => s.type !== "null");
    if (rest.length === 1 && rest.length < (o.anyOf as Json[]).length) {
      const { anyOf: _a, ...others } = o;
      return dropNull({ ...rest[0], ...others });
    }
  }
  const out: Json = {};
  for (const [k, v] of Object.entries(o)) out[k] = dropNull(v);
  return out;
}

function toJson(schema: z.ZodType): Json {
  const { $schema: _s, ...json } = z.toJSONSchema(schema, CONVERSION) as Json;
  return dropNull(json) as Json;
}

/// One target's payload, as published. `required` moves into the words:
/// on SUPERSEDE and CONTRADICT the payload carries only what changed.
export function publishedPayload(target: ProposalTargetLike): Json {
  const json = toJson(PAYLOADS[target]);
  const props = { ...(json.properties as Record<string, Json>) };
  for (const k of [...NOT_PUBLISHED.all, ...(NOT_PUBLISHED[target] ?? [])]) delete props[k];
  if (target === "POLICY") {
    const params = toJson(PolicyParamsPublished);
    props.params = params;
    props.interimParams = { ...params, description: "params of the interim rule." };
  }
  if (target === "PROCESS") {
    const steps = props.steps as Json & { items: Json & { properties: Record<string, Json> } };
    steps.items.properties.actionTags = { type: "array", items: { type: "string", enum: [...ACTION_TAGS] } };
  }
  const required = ((json.required as string[]) ?? []).filter((k) => k in props);
  const needs = required.length ? ` On CREATE it needs ${required.join(", ")}; on SUPERSEDE or CONTRADICT, only the fields that change.` : "";
  return {
    title: target,
    description: `When target is ${target}. ${PAYLOAD_NOTES[target]}${needs}`,
    type: "object",
    properties: props,
  };
}

/// Every closed list the server validates a payload with, as
/// "TARGET.path": values. Read from PAYLOADS, for the tests and the
/// description.
export function payloadEnums(target: ProposalTargetLike): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const o = node as Json;
    if (Array.isArray(o.enum)) out[path] = o.enum as string[];
    if (o.properties) for (const [k, v] of Object.entries(o.properties as Json)) walk(v, path ? `${path}.${k}` : k);
    if (o.items) walk(o.items, `${path}[]`);
    for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(o[key])) for (const v of o[key] as unknown[]) walk(v, path);
  };
  walk(toJson(PAYLOADS[target]), "");
  return out;
}

/// The call's runtime schema, published as `published`. The SDK reads the
/// JSON Schema from `~standard.jsonSchema` (StandardJSONSchemaV1) and
/// validates with `~standard.validate`, so the two can differ: here the
/// published one says more, and the runtime one stays lenient.
export function publishAs<T extends z.ZodType>(runtime: T, published: () => Json): StandardSchemaWithJSON<z.input<T>, z.output<T>> {
  let cached: Json | null = null;
  const json = () => (cached ??= published());
  return {
    "~standard": {
      version: 1,
      vendor: "ankora",
      validate: (value: unknown) => runtime["~standard"].validate(value),
      jsonSchema: { input: () => json(), output: () => json() },
    },
  } as unknown as StandardSchemaWithJSON<z.input<T>, z.output<T>>;
}

/// The published items[]: the runtime item, with `payload` described per
/// target (anyOf, each titled by its target).
export function withPublishedPayloads(runtimeJson: Json): Json {
  const items = (runtimeJson.properties as Record<string, Json>).items as Json & { items: Json & { properties: Record<string, Json> } };
  items.items.properties.payload = {
    description: "This item's fields, by its target: use the variant whose title is the item's target.",
    anyOf: PROPOSAL_TARGETS.map(publishedPayload),
  };
  return runtimeJson;
}

export function publishedInput(runtime: z.ZodType): Json {
  return withPublishedPayloads(toJson(runtime));
}

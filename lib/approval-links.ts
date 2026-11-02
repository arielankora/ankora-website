// Direct links into the app, for Claude (2.11.2026). Until now the MCP
// tools could say "the approvals screen, tab ידע מהחילוץ" and no more, so
// a person handed a list of decisions had to find each one by reading.
// Every link here opens the screen where the item is decided and scrolls
// to it: the row on "אישורים", the proposal inside its batch, the process
// in the client's file, the decision in the client's panel.
//
// Pure, with no imports, so the anchors the screens render and the links
// the tools hand out are one definition and a test can hold them to it.

/// What may stand in an element id and a URL fragment without encoding.
/// A process decision's id is "<processId>:<step>"; the colon would be
/// encoded in the link and then fail to match the element.
function safe(part: string): string {
  return part.replace(/[^A-Za-z0-9_-]/g, "-");
}

/// The id of one row on "אישורים" (ApprovalRow).
export function approvalAnchor(kind: string, id: string): string {
  return `approval-${safe(kind)}-${safe(id)}`;
}

/// The id of one batch on the knowledge review (ReviewBatch).
export function batchAnchor(batchId: string): string {
  return `batch-${safe(batchId)}`;
}

/// The id of one proposal inside its batch (ProposalRow).
export function proposalAnchor(proposalId: string): string {
  return `proposal-${safe(proposalId)}`;
}

/// The id of one decision in the client's decisions panel.
export function decisionAnchor(decisionId: string): string {
  return `decision-${safe(decisionId)}`;
}

function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function approvalsPath(tab: string, clientId: string | null): string {
  const q = new URLSearchParams();
  q.set("tab", tab);
  if (clientId) q.set("clientId", clientId);
  return `/app/approvals?${q.toString()}`;
}

/// The row itself on "אישורים", on its own tab and client, so it is on
/// the screen whatever else waits. A knowledge row opens its batch.
export function approvalRowUrl(baseUrl: string, item: { kind: string; id: string; clientId: string | null }): string {
  const hash = item.kind === "knowledge" ? batchAnchor(item.id) : approvalAnchor(item.kind, item.id);
  return join(baseUrl, `${approvalsPath(item.kind, item.clientId)}#${hash}`);
}

/// A page path the app already uses (an item's href), made absolute.
export function appUrl(baseUrl: string, href: string): string {
  return href.startsWith("http") ? href : join(baseUrl, href.startsWith("/") ? href : `/${href}`);
}

/// One batch of proposals, on the knowledge review of its client.
export function batchUrl(baseUrl: string, clientId: string, batchId: string): string {
  return join(baseUrl, `${approvalsPath("knowledge", clientId)}#${batchAnchor(batchId)}`);
}

/// One proposal, on the knowledge review of its client.
export function proposalUrl(baseUrl: string, clientId: string, proposalId: string): string {
  return join(baseUrl, `${approvalsPath("knowledge", clientId)}#${proposalAnchor(proposalId)}`);
}

/// A process, in the client's file.
export function processUrl(baseUrl: string, clientId: string, processId: string): string {
  return join(baseUrl, `/app/clients/${encodeURIComponent(clientId)}?tab=file#item-${safe(processId)}`);
}

/// A decision asked of the client, in the client's decisions panel.
export function clientDecisionUrl(baseUrl: string, clientId: string, decisionId: string): string {
  return join(baseUrl, `/app/clients/${encodeURIComponent(clientId)}#${decisionAnchor(decisionId)}`);
}

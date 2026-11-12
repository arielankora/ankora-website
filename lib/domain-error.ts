// ADR 0006: a refusal from the domain, with a code a screen can word in
// the reader's language.
//
// It is still an Error, and its message is still the sentence the domain
// has always thrown, in whatever language it was written. That matters:
// the MCP tools hand `message` to Claude, existing tests match on it, and
// none of them should change because a screen learned a second language.
// A screen that wants the reader's language asks for the code instead
// (lib/i18n/domain-errors.ts).
//
// `code` is "<area>.<name>" and names a key under `domainErrors` in
// messages/*.json. `values` fills the message's placeholders.

export type DomainErrorValues = Record<string, string | number>;

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly values: DomainErrorValues = {},
  ) {
    super(message);
    this.name = "DomainError";
  }
}

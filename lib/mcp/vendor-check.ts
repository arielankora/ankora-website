// P8 (3.11.2026): what a tool tells Claude to do with a `vendorCheck`.
// Pure, like annotations.ts, so a unit test can read it.

// 3.11.2026, after false alarms in production: Claude is the filter. It
// reads the task and the conversation, which the server's word match
// cannot, and only a likely vendor reaches the person.
export const VENDOR_CHECK_NEXT =
  "vendorCheck: the task's text names something that may be a new vendor of the app or the service Ankora gives clients. Judge it first from the task and the conversation. If it is clearly not a vendor (a test, a code, a person, an internal screen, a known library, marketing or Ankora's own back office), call decide_vendor_check with NOT_A_VENDOR yourself and tell the user in one line. Only if it plausibly is a vendor that will reach client data, ask the user, naming it, whether to open a P8 (new subprocessor) run, and answer with their decision. If nobody answers for a business day, the run opens on its own.";

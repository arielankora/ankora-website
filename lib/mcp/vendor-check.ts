// P8 (3.11.2026): what a tool tells Claude to do with a `vendorCheck`.
// Pure, like annotations.ts, so a unit test can read it.

export const VENDOR_CHECK_NEXT =
  "vendorCheck: this task looks like connecting a new vendor to the app or the service Ankora gives clients. Ask the user, naming the vendor (or asking which one), whether it will reach client data and needs a P8 (new subprocessor) run. Then call decide_vendor_check with their answer. Do not decide it yourself. If nobody answers for a business day, the run opens on its own.";

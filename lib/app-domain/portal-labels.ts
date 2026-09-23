import type { ClientDocumentKind, PortalDigest, SupplierExperience } from "@prisma/client";

// Portal phase 3. The Hebrew for three enums, in a module with no
// "server-only" at the top.
//
// Not a style choice: the client's file has forms in it, forms are client
// components, and a client component that imports a server-only module
// fails the build. The labels are the only part of that domain a browser
// needs, so they live where a browser can reach them and the logic stays
// where it belongs.

export const DIGEST_LABELS: Record<PortalDigest, string> = {
  EVERY_DECISION: "כל החלטה, ברגע שהיא נפתחת",
  WEEKLY: "סיכום שבועי",
  MONTHLY: "רק הסיכום החודשי",
};

export const DOCUMENT_KIND_LABELS: Record<ClientDocumentKind, string> = {
  POLICY: "פוליסה",
  CERTIFICATE: "אישור",
  CONTRACT: "חוזה",
  INVOICE: "חשבונית",
  OTHER: "מסמך",
};

export const SUPPLIER_EXPERIENCE_LABELS: Record<SupplierExperience, string> = {
  GOOD: "מומלץ",
  OK: "בסדר",
  AVOID: "לא נשתמש שוב",
};

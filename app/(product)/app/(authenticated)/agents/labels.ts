// Agents, phase 1: the Hebrew names of the model's values on the screens.

export const BLOCK_KIND_LABEL = {
  role: "תפקיד וזהות",
  scope: "היקף",
  steps: "צעדי עבודה",
  rules: "כללים ואיסורים",
  approvals: "אישורים נדרשים",
  language: "שפה וסגנון",
  output: "פורמט פלט",
  tools: "כלים וחיבורים",
  schedule: "תזמון",
  live: "הקשר חי מאנקורה",
} as const;

export const PARAM_LEVEL_LABEL = { AGENT: "הסוכן (ערך אחד לכולם)", CLIENT: "לקוח", INSTALLATION: "התקנה (מי שמריץ)" } as const;

export const PARAM_TYPE_LABEL = { TEXT: "טקסט", LONG_TEXT: "טקסט ארוך", NUMBER: "מספר (למשל מכסה)", LIST: "רשימה", EMAIL: "מייל", FILE_LOCATION: "מיקום קובץ", PAGE: "דף פלט", LIBRARY_BLOCK: "קטע מהספרייה (לפי מפתח)", CONNECTOR: "חיבור (לפי שם)", VAULT_REF: "פריט בכספת (שם בלבד, בלי הערך)" } as const;

export const SURFACE_LABEL = { PROJECT: "פרויקט Claude", SCHEDULED: "משימה מתוזמנת", PERSISTENT_SESSION: "שיחה קבועה", SKILL: "סקיל" } as const;

export const KIND_LABEL = { CLIENT_PROJECT: "פרויקט Claude", SCHEDULED: "משימה מתוזמנת", SKILL: "סקיל" } as const;

export const ACTION_LEVEL_LABEL = { READ: "קורא בלבד", DRAFT: "כותב טיוטות", SEND: "שולח בשם אדם" } as const;

export const STATE_LABEL = { DRAFT: "טיוטה", PENDING: "ממתינה לאישור", APPROVED: "מאושרת", REJECTED: "נדחתה" } as const;

export const RUN_LABEL = { OK: "תקינה", PARTIAL: "חלקית", FAILED: "נכשלה" } as const;

export const CHECK_LABEL = { RUN: "בכל ריצה", DAILY: "יומית", WEEKLY: "שבועית" } as const;

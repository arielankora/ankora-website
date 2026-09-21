import type { Locale } from "@/content";
import type { CustomerType, Outcome, StorySectionKind, UseCase } from "./types";

/**
 * Chrome and taxonomy labels for the Customer Stories section, in both locales.
 *
 * Kept beside the stories rather than merged into content/he.ts + content/en.ts: those
 * two files are ~100KB each and shared by every page on the site. A self-contained
 * section owns its own strings, the same way app/[locale]/solutions/executives/page.tsx
 * owns its own metadata pair.
 */
export interface StoriesUi {
  navLabel: string;
  eyebrow: string;
  h1: string;
  lead: string;
  leadQuestion: string;
  metaTitle: string;
  metaDescription: string;
  countLabel: { one: string; many: string };
  readStory: string;
  backToHub: string;
  storyEyebrow: string;
  areasManagedLabel: string;
  outcomesLabel: string;
  independentEvidenceLabel: string;
  independentEvidenceLead: string;
  independentEvidenceCta: string;
  independentEvidenceNote: string;
  independentEvidencePointer: string;
  quoteLabel: string;
  relatedLabel: string;
  proofHeading: string;
  proofLead: string;
  proofCta: string;
  sectionTitles: Record<StorySectionKind, string>;
  customerTypes: Record<CustomerType, string>;
  useCases: Record<UseCase, string>;
  outcomes: Record<Outcome, string>;
}

const he: StoriesUi = {
  navLabel: "סיפורי לקוחות",
  eyebrow: "סיפורי לקוחות",
  h1: "סיפורי לקוחות",
  leadQuestion: "איך נראה ניהול תפעול אישי בפועל?",
  lead: "בסיפורי הלקוחות של Ankora אנחנו מציגים דוגמאות אמיתיות לאופן שבו מנהלים ויזמים מעבירים משימות ואחריות תפעולית ל־Ankora — ומפנים לעצמם זמן, קשב ופוקוס לדברים שבהם הם מייצרים את הערך הגבוה ביותר.",
  metaTitle: "סיפורי לקוחות | ניהול תפעול אישי בפועל | Ankora",
  metaDescription:
    "דוגמאות אמיתיות למנהלים ויזמים בישראל שמעבירים אחריות תפעולית — אישית ועסקית — למנהל תפעול ייעודי ב־Ankora, ומה השתנה אצלם ביום־יום.",
  countLabel: { one: "סיפור אחד", many: "{n} סיפורים" },
  readStory: "לסיפור המלא",
  backToHub: "חזרה לסיפורי לקוחות",
  storyEyebrow: "סיפור לקוח",
  areasManagedLabel: "תחומי אחריות שהועברו",
  outcomesLabel: "מה השתנה",
  independentEvidenceLabel: "מקור חיצוני",
  independentEvidenceLead: "הלקוח כתב על זה בעצמו.",
  independentEvidenceCta: "לקריאת הפוסט המקורי",
  independentEvidenceNote: "פורסם על ידי הלקוח בערוץ שלו, מחוץ לאתר של Ankora. הסיפור שלמעלה נכתב על ידי Ankora.",
  independentEvidencePointer: "מקור חיצוני",
  quoteLabel: "בלשונו",
  relatedLabel: "קריאה קשורה",
  proofHeading: "מה קורה כשמעבירים אחריות",
  proofLead: "דוגמה אמיתית לאופן שבו ניהול תפעול אישי עובד בשטח.",
  proofCta: "לכל סיפורי הלקוחות",
  sectionTitles: {
    context: "הרקע",
    problem: "העומס התפעולי",
    "why-alternatives-fell-short": "למה הפתרונות הקיימים לא הספיקו",
    "ankora-approach": "המודל של Ankora",
    "how-the-work-is-managed": "איך העבודה מתנהלת",
    outcome: "מה השתנה",
  },
  customerTypes: {
    ceo: "מנכ״ל",
    founder: "מייסד",
    executive: "מנהל בכיר",
    entrepreneur: "יזם",
    family: "משפחה ומשק בית",
    company: "חברה",
  },
  useCases: {
    vendors: "ספקים",
    travel: "נסיעות",
    administration: "מנהלה",
    "personal-tasks": "משימות אישיות",
    "business-operations": "תפעול עסקי",
    household: "משק בית",
    bureaucracy: "בירוקרטיה",
    coordination: "תיאומים",
    "follow-up": "מעקב וסגירת קצוות",
  },
  outcomes: {
    "time-saved": "חיסכון בזמן",
    "reduced-operational-load": "הפחתת עומס תפעולי",
    "end-to-end-ownership": "אחריות מקצה לקצה",
    "faster-execution": "ביצוע מהיר יותר",
    "fewer-open-loops": "פחות קצוות פתוחים",
    "assistant-alternative": "חלופה לגיוס עוזר אישי במשרה מלאה",
  },
};

const en: StoriesUi = {
  navLabel: "Customer Stories",
  eyebrow: "Customer Stories",
  h1: "Customer Stories",
  leadQuestion: "What does Personal Operations Management look like in practice?",
  lead: "Real examples of how executives and founders hand operational responsibility to Ankora - not just individual tasks - and get back the time and attention they need for the work only they can do.",
  metaTitle: "Customer Stories | Personal Operations Management in Practice | Ankora",
  metaDescription:
    "Real examples of executives and founders in Israel who transfer personal and business operational responsibility to a dedicated Ankora Operations Manager, and what changed day to day.",
  countLabel: { one: "One story", many: "{n} stories" },
  readStory: "Read the story",
  backToHub: "Back to Customer Stories",
  storyEyebrow: "Customer Story",
  areasManagedLabel: "Responsibility transferred",
  outcomesLabel: "What changed",
  independentEvidenceLabel: "Independent source",
  independentEvidenceLead: "The customer wrote about this himself.",
  independentEvidenceCta: "Read the original post",
  independentEvidenceNote: "Published by the customer on his own channel, outside Ankora's site. The story above is Ankora's own account.",
  independentEvidencePointer: "Independent source",
  quoteLabel: "In their words",
  relatedLabel: "Related reading",
  proofHeading: "What happens when responsibility moves",
  proofLead: "A real example of how Personal Operations Management works in practice.",
  proofCta: "All customer stories",
  sectionTitles: {
    context: "Context",
    problem: "The operational load",
    "why-alternatives-fell-short": "Why the existing options were not enough",
    "ankora-approach": "The Ankora model",
    "how-the-work-is-managed": "How the work is managed",
    outcome: "What changed",
  },
  customerTypes: {
    ceo: "CEO",
    founder: "Founder",
    executive: "Executive",
    entrepreneur: "Entrepreneur",
    family: "Family / household",
    company: "Company",
  },
  useCases: {
    vendors: "Vendors",
    travel: "Travel",
    administration: "Administration",
    "personal-tasks": "Personal tasks",
    "business-operations": "Business operations",
    household: "Household",
    bureaucracy: "Bureaucracy",
    coordination: "Coordination",
    "follow-up": "Follow-up",
  },
  outcomes: {
    "time-saved": "Time saved",
    "reduced-operational-load": "Reduced operational load",
    "end-to-end-ownership": "End-to-end ownership",
    "faster-execution": "Faster execution",
    "fewer-open-loops": "Fewer open loops",
    "assistant-alternative": "Alternative to a full-time assistant",
  },
};

export const STORIES_UI: Record<Locale, StoriesUi> = { he, en };

export function storiesUi(locale: Locale): StoriesUi {
  return STORIES_UI[locale] ?? STORIES_UI.he;
}

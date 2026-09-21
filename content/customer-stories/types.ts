import type { Locale } from "@/content";

/**
 * The Customer Stories content model.
 *
 * Deliberately a typed content module rather than MDX: unlike a blog post, a customer
 * story is a set of *named claims* (who, context, problem, what Ankora owned, outcome,
 * evidence) that the hub card, the story page, the cross-page proof block and the
 * JSON-LD all have to read individually. MDX would collapse them into one opaque body
 * and every consumer would have to re-parse it.
 *
 * Every narrative field except the identifying ones is optional. A story publishes with
 * what is actually evidenced and nothing else - empty fields render no empty headings.
 */

/** Future taxonomy. Present in the model from day one so stories are already classified
 *  when there are enough of them to justify exposing filters. No filter UI ships until
 *  then: a filter row over one story is a filter row that returns one story. */
export const CUSTOMER_TYPES = [
  "ceo",
  "founder",
  "executive",
  "entrepreneur",
  "family",
  "company",
] as const;

export const USE_CASES = [
  "vendors",
  "travel",
  "administration",
  "personal-tasks",
  "business-operations",
  "household",
  "bureaucracy",
  "coordination",
  "follow-up",
] as const;

export const OUTCOMES = [
  "time-saved",
  "reduced-operational-load",
  "end-to-end-ownership",
  "faster-execution",
  "fewer-open-loops",
  "assistant-alternative",
] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export type UseCase = (typeof USE_CASES)[number];
export type Outcome = (typeof OUTCOMES)[number];

/** A solution/service route this story is evidence for. Drives the contextual
 *  cross-linking in both directions: story -> solution, and solution -> story. */
export type RelatedSolution =
  | "/personal-operations-management"
  | "/ankora-vs-personal-assistant"
  | "/personal-assistant-for-executives"
  | "/how-it-works"
  | "/solutions/executives"
  | "/solutions/founders"
  | "/solutions/companies"
  | "/solutions/family-office";

export interface CustomerQuote {
  /** The customer's own words. Never paraphrased, never composed for them. */
  text: string;
  /** Where the words were said, if said publicly. Omit for a quote given privately
   *  with permission to publish. */
  sourceUrl?: string;
  sourceLabel?: string;
}

/** A section of the story body. Stories are not forced into one editorial shape - the
 *  semantic concepts are carried by the section kind, and a story renders only the
 *  kinds it has evidence for, in the order the author listed them. */
export type StorySectionKind =
  | "context"
  | "problem"
  | "why-alternatives-fell-short"
  | "ankora-approach"
  | "how-the-work-is-managed"
  | "outcome";

export interface StorySection {
  kind: StorySectionKind;
  /** Overrides the default localized heading for this kind. */
  title?: string;
  /** Plain paragraphs. Crawlable HTML text - never an image of text, never
   *  client-only, never behind an accordion. */
  body: string[];
  /** Optional list rendered under the paragraphs (e.g. what Ankora took ownership of). */
  items?: string[];
}

export interface CustomerStory {
  /** ASCII slug, shared across locales so /he and /en are true alternates of each
   *  other. Same constraint as blog slugs (lib/blog-shared.ts). */
  slug: string;
  locale: Locale;

  customerName: string;
  customerRole?: string;
  customerCompany?: string;
  customerType: CustomerType;

  /** The card headline: the problem or the shift, not the person's name. */
  headline: string;
  /** One or two sentences. Used on the card, in the meta description, and in the
   *  ItemList JSON-LD. */
  summary: string;

  /** The story body. Order is the order it renders in. */
  sections: StorySection[];

  /** What Ankora took ownership of, as taxonomy. Rendered as readable labels on the
   *  story page, and used for future filtering. */
  areasManaged?: UseCase[];
  outcomes?: Outcome[];

  quote?: CustomerQuote;

  /** INDEPENDENT evidence only: a customer-authored post, their own site, a podcast,
   *  an interview, an article. An Ankora-hosted page is owned evidence and never goes
   *  here. */
  independentEvidence?: {
    url: string;
    label: string;
    /** e.g. "LinkedIn", "Podcast", "Press" */
    type: string;
  };

  /** A portrait of the customer, square source (min 800x800). Rendered square in both
   *  places it appears - a customer story's image is a face, and a face cropped to a
   *  16:7 band is a strip of forehead. Never used as a background behind type. */
  image?: { src: string; alt: string };

  relatedSolutions?: RelatedSolution[];

  publishedDate: string;
  updatedDate?: string;

  /** Unpublished stories are excluded from the hub, the sitemap, every proof block,
   *  and return 404. Approval gate for stories drafted before the customer has signed
   *  off on the wording. */
  draft?: boolean;
}

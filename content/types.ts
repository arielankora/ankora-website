export type Locale = "he" | "en";

/**
 * The six operational domains, in the order the site presents them. Used by the
 * capabilities list on the home page and by the ROI calculator's hour rows, which
 * are deliberately the same six things.
 */
export type CapabilityId =
  | "business"
  | "vendors"
  | "personal"
  | "admin"
  | "travel"
  | "property";

/**
 * The four "who it's for" profiles, keyed rather than positional so the gravity matrix
 * cannot silently misalign with the segment content it is read against.
 */
export type ProfileId = "executives" | "founders" | "companies" | "familyOffice";

/** How much of a profile's operational weight a capability carries. */
export type GravityWeight = "lead" | "support" | "light";

export interface Dictionary {
  meta: {
    title: string;
    description: string;
    homeTitle: string;
    homeDescription: string;
    aboutTitle: string;
    aboutDescription: string;
  };
  nav: {
    home: string;
    solutions: string;
    howItWorks: string;
    technology: string;
    about: string;
    pricing: string;
    roi: string;
    coverage: string;
    cta: string;
    personalOperationsManagement: string;
    personalAssistantForExecutives: string;
    ankoraVsPersonalAssistant: string;
    relatedReading: string;
    blog: string;
    solutionsMenu: { label: string; blurb: string; href: string }[];
  };
  hero: {
    eyebrow: string;
    // Two lines, not one string: the spec styles them differently (line 1 #F8F4EC
    // weight 200, line 2 #B08D57 weight 300) and reveals them with a stagger, so the
    // split has to exist in the data rather than in a `\n` the component guesses at.
    titleLine1: string;
    titleLine2: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    definitionPre: string;
    definitionLinked: string;
    definitionPost: string;
    // The three live panels under the hero. `businessTasks` and `personalTasks` are
    // two separate pools on purpose: the rotation is composed, always two business
    // items and one personal one, never a random draw from a single list.
    live: {
      nowLabel: string;
      closedLabel: string;
      closedSub: string;
      sparkLabel: string;
      orchLabel: string;
      orchRows: string[];
      businessTasks: { text: string; domain: string }[];
      personalTasks: { text: string; domain: string }[];
    };
  };
  // The four-cell stats strip under the hero.
  stats: { value: string; label: string }[];
  problem: { label: string; title: string; body: string };
  insight: { label: string; title: string; body: string };
  category: { label: string; title: string; body: string };
  howItWorks: {
    label: string;
    title: string;
    sub: string;
    steps: { title: string; body: string }[];
    // The home page's two-lane comparison ("one task, two routes"): the same task
    // with and without Ankora, with the five interruption ticks rendered on the
    // "without" lane only. The inner /how-it-works page uses `steps` and its own
    // sticky progress rail instead.
    railLabel: string;
    attentionLabel: string;
    laneWithout: string;
    laneWith: string;
    noteWithout: string;
    noteWith: string;
  };
  intelligence: {
    label: string;
    // Two lines; line 2 is gold. Same reasoning as hero.titleLine1/2.
    titleLine1: string;
    titleLine2: string;
    body: string;
    // `key` is the Latin mono key above the title (MEMORY, ORCHESTRATION, ...).
    pillars: { key: string; title: string; body: string }[];
  };
  capabilities: {
    label: string;
    title: string;
    sub: string;
    // `key` is the Latin mono key (BUSINESS OPS, VENDORS, ...). It lives here rather
    // than in a parallel array in the component, which is how the previous version
    // drifted out of step with the item order. The 01..06 index is derived from
    // position at render time for the same reason -- it cannot go stale.
    //
    // `id` is the stable identifier the ROI calculator's hour rows reference. The
    // calculator measures the same six domains this list names, so its rows take
    // their labels from here rather than repeating them: renaming a capability
    // renames its ROI row, and the two can never describe different taxonomies.
    items: { id: CapabilityId; key: string; title: string; body: string }[];
  };
  humanAI: {
    label: string;
    title: string;
    body: string;
    humanTitle: string;
    human: string[];
    aiTitle: string;
    ai: string[];
  };
  industries: {
    label: string;
    title: string;
    // Card link label. It carries its own arrow glyph, which points in the reading
    // direction of its own language, so the component never has to flip it.
    itemCta: string;
    items: { title: string; body: string; href: string }[];
  };
  trust: {
    label: string;
    title: string;
    body: string;
    badges: string[];
  };
  faq: {
    label: string;
    title: string;
    items: { q: string; a: string }[];
  };
  finalCta: { title: string; body: string; cta: string };
  blog: {
    eyebrow: string;
    title: string;
    sub: string;
    emptyState: string;
    readMore: string;
    minRead: string;
    allCategories: string;
    relatedTitle: string;
    backToBlog: string;
    categories: Record<string, string>;
  };
  pages: PagesContent;
  footer: {
    tagline: string;
    rights: string;
    privacy: string;
    terms: string;
  };
}

export interface SegmentContent {
  eyebrow: string;
  title: string;
  sub: string;
  bullets: { title: string; body: string }[];
  closing: string;
}

/**
 * The bridge paragraph at the top of a segment page, carrying two inline links --
 * one to the category explainer, one to the personal-assistant comparison. Stored in
 * fragments because the links sit mid-sentence and the word order differs between
 * Hebrew and English.
 */
export interface SegmentBridge {
  pre: string;
  categoryLink: string;
  mid: string;
  comparisonLink: string;
  post: string;
  moreLabel: string;
}

export interface SimplePageContent {
  eyebrow: string;
  title: string;
  sub: string;
  blocks: { title: string; body: string }[];
}

export interface PagesContent {
  howItWorks: SimplePageContent & {
    vignette: {
      title: string;
      body: string;
      // The four tasks the paragraph names, laid out as one day. `time` is a mono
      // label (morning / midday / afternoon / evening), not a clock reading.
      items: { time: string; title: string; note: string }[];
    };
  };
  technology: SimplePageContent & {
    // The four-layer diagram above the technology cards. `side` is the one thing
    // colour encodes on this page — who does the work — so it is data rather than a
    // class name chosen at the call site: the first layer is the client's, the other
    // three are Ankora's.
    orchestrationLabel: string;
    sideYou: string;
    sideAnkora: string;
    layers: { tag: string; side: "you" | "ankora"; title: string; body: string }[];
    persistenceNote: string;
    // Only this page overrides the shared closing CTA heading.
    ctaTitle: string;
  };
  about: SimplePageContent & {
    entityDefinition: string;
    principlesLabel: string;
    principles: { title: string; body: string }[];
  };
  solutionsIndex: {
    eyebrow: string;
    title: string;
    sub: string;
    /** Eyebrow above the four profile rows. */
    profilesLabel: string;
    /** Mono label above each row's three focus areas. */
    focusLabel: string;
    /**
     * The closing argument: the profile changes, the operating layer does not. It is
     * what makes this an index worth reading rather than four links -- the four
     * profile pages cannot make this point, because each of them only sees one.
     */
    constantLabel: string;
    constantTitle: string;
    constantBody: string;
    /**
     * The 6 x 4 weighting behind the closing section: capabilities against profiles,
     * three states. It is what makes that section argue its own headline -- the centre
     * of gravity moves, the layer does not -- instead of repeating six titles the
     * visitor has already read twice.
     *
     * Keyed both ways rather than the positional `[4][6]` the handoff proposed: an
     * array of arrays is correct only as long as two orders stay in step, and the
     * capability order has already changed once (C01).
     */
    gravity: {
      /** Column head over the capability labels. */
      capabilityLabel: string;
      /** Read out per cell and shown in the legend -- the states are not colour-only. */
      legend: Record<GravityWeight, string>;
      weights: Record<ProfileId, Record<CapabilityId, GravityWeight>>;
    };
    /** One line under the closing section, pointing undecided readers at the ROI page. */
    undecided: { label: string; link: string };
  };
  roi: {
    eyebrow: string;
    title: string;
    sub: string;
    personaPrompt: string;
    // Heading above the six hour rows.
    hoursPrompt: string;
    hoursUnitLabel: string;
    hoursTotalLabel: string;
    rateNote: string;
    nonProductiveLabel: string;
    nonProductiveHint: string;
    nonProductiveDefault: number;
    // One row per capability, in capability order. Only the hint lives here -- the
    // row's label comes from `capabilities.items`, so the calculator and the
    // capabilities list can never drift into describing different domains.
    hourNotes: Record<CapabilityId, string>;
    personas: {
      key: "executives" | "founders" | "companies" | "familyOffice";
      // Starting hours per domain. Shared rows, per-persona weights: a growing
      // company and a family office run very different operations, and flattening
      // them to one profile was the thing worth avoiding when the calculator moved
      // from four bespoke questionnaires to one shared set (Ariel's decision, C02).
      hours: Record<CapabilityId, number>;
      rateLabel: string;
      rateHint: string;
      rateDefault: number;
    }[];
    results: {
      title: string;
      hoursFreedLabel: string;
      valueFreedLabel: string;
      valueFreedHint: string;
      costLabel: string;
      costHint: string;
      netValueLabel: string;
      multipleLabel: string;
      multipleSuffix: string;
      ctaBody: string;
      cta: string;
      footnote: string;
    };
    hiddenCost: {
      label: string;
      title: string;
      body: string;
      items: { title: string; body: string }[];
    };
  };
  pricing: {
    eyebrow: string;
    title: string;
    sub: string;
    billing: {
      label: string;
      title: string;
      body: string;
      points: { title: string; body: string }[];
    };
    costCompare: {
      label: string;
      title: string;
      body: string;
      inHouseTitle: string;
      ankoraTitle: string;
      // Two dimensions rather than two flat lists: the old shape put six in-house
      // costs beside three Ankora lines and left the reader to work out which
      // answered which. Each row now asks one question of both columns.
      rows: { dimension: string; inHouse: string[]; ankora: string[] }[];
    };
    hourBank: {
      label: string;
      title: string;
      body: string;
      points: { title: string; body: string }[];
    };
    tiers: {
      label: string;
      title: string;
      sub: string;
      items: { name: string; hours: string; rate: string; blurb: string; highlighted: boolean }[];
      footnote: string;
    };
    // secondaryCta: optional /he addition -- links to the ROI calculator alongside
    // the existing contact CTA, since the ROI page answers the closing question
    // ("how much time does this actually save?") directly. Optional so /en (unchanged
    // this round) doesn't need it.
    closing: { title: string; body: string; cta: string; secondaryCta?: string };
  };
  contact: {
    eyebrow: string;
    title: string;
    sub: string;
    nameLabel: string;
    emailLabel: string;
    companyLabel: string;
    messageLabel: string;
    submit: string;
    directTitle: string;
    directBody: string;
    // Two short reassurances beside the direct-contact details.
    directPoints: string[];
    successMessage: string;
    errorMessage: string;
  };
  legal: {
    privacyTitle: string;
    termsTitle: string;
    placeholder: string;
    termsPlaceholder: string;
    /** Rendered in the page hero, marked up as <time>. Recency is metadata about the
     *  document, not about its contents index, and it is often the one fact a visitor
     *  came for. */
    updated: string;
    /** ISO YYYY-MM behind `updated`, for the <time datetime> attribute. */
    updatedISO: string;
    /** Heading over the sticky section index on the legal pages. */
    contentsLabel: string;
    privacySections: { title: string; body: string }[];
    termsSections: { title: string; body: string }[];
  };
  segmentBridge: SegmentBridge;
  segments: {
    executives: SegmentContent;
    founders: SegmentContent;
    companies: SegmentContent;
    familyOffice: SegmentContent;
  };
  coverage: {
    eyebrow: string;
    title: string;
    sub: string;
    intro: string;
    searchPlaceholder: string;
    // Short label shown in place of the counter when nothing matches. The long
    // "no results, try another word" sentence it replaces is superseded by the
    // empty-state block below, which says the same thing and offers a way forward.
    noResultsLabel: string;
    // /he redesign new UI chrome (design_handoff_ankora_redesign/README.md, "10. Coverage"):
    // the live "N domains / M services" counter labels and the empty-state CTA button.
    // Optional so /en (unchanged design, no counter/CTA button in that layout) doesn't need them.
    areaCountLabel: string;
    serviceCountLabel: string;
    emptyStateCta: string;
    clearSearch: string;
    // Shown when a search matches nothing. `emptyStateTitle` takes the query, so it
    // carries a single {query} placeholder rather than being assembled from
    // fragments in the component -- Hebrew and English put the quoted term in
    // different places.
    emptyStateTitle: string;
    emptyStateBody: string;
    categories: {
      name: string;
      description: string;
      services: { name: string; description: string }[];
    }[];
  };
  personalOperationsManagement: {
    eyebrow: string;
    title: string;
    sub: string;
    directAnswerLabel: string;
    directAnswer: string;
    problem: {
      title: string;
      intro: string;
      items: string[];
      closing: string;
    };
    whatManagerDoes: {
      title: string;
      body: string;
      examples: { title: string; body: string }[];
    };
    comparisonPA: {
      title: string;
      intro: string;
      columnA: string;
      columnB: string;
      rows: { dimension: string; a: string; b: string }[];
    };
    comparisonConcierge: {
      title: string;
      intro: string;
      columnA: string;
      columnB: string;
      rows: { dimension: string; a: string; b: string }[];
    };
    humanAI: {
      title: string;
      body: string;
      points: { title: string; body: string }[];
    };
    whoFor: {
      title: string;
      items: string[];
    };
    examples: {
      title: string;
      items: { scenario: string; shallow: string; deep: string }[];
    };
    notRightFit: {
      title: string;
      body: string;
      items: string[];
    };
    faq: { q: string; a: string }[];
    ctaTitle: string;
    ctaBody: string;
    cta: string;
  };
  personalAssistantForExecutives: {
    eyebrow: string;
    title: string;
    sub: string;
    directAnswer: string;
    expectations: { title: string; items: string[] };
    whenPARight: { title: string; body: string };
    wherePAFalls: { title: string; body: string; items: string[] };
    ankoraModel: { title: string; body: string; points: { title: string; body: string }[] };
    whenFullTimePA: { title: string; body: string; items: string[] };
    faq: { q: string; a: string }[];
    ctaTitle: string;
    ctaBody: string;
    cta: string;
  };
  ankoraVsPersonalAssistant: {
    eyebrow: string;
    title: string;
    sub: string;
    directAnswer: string;
    columnA: string;
    columnB: string;
    table: { dimension: string; a: string; b: string }[];
    choosePA: { title: string; items: string[] };
    chooseAnkora: { title: string; items: string[] };
    whereAnkoraFits: { title: string; body: string };
    faq: { q: string; a: string }[];
    ctaTitle: string;
    ctaBody: string;
    cta: string;
  };
}

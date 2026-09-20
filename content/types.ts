export type Locale = "he" | "en";

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
    items: { key: string; title: string; body: string }[];
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
  solutionsIndex: { eyebrow: string; title: string; sub: string };
  roi: {
    eyebrow: string;
    title: string;
    sub: string;
    personaPrompt: string;
    hoursUnitLabel: string;
    hoursTotalLabel: string;
    rateNote: string;
    nonProductiveLabel: string;
    nonProductiveHint: string;
    nonProductiveDefault: number;
    personas: {
      key: "executives" | "founders" | "companies" | "familyOffice";
      hourQuestions: { label: string; hint: string; default: number }[];
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
      inHouseItems: string[];
      ankoraTitle: string;
      ankoraItems: string[];
    };
    hourBank: {
      label: string;
      title: string;
      body: string;
      points: { title: string; body: string }[];
      // /he only: the 3-month rollover bar chart + its legend (Ariel: "without the legend
      // the diagram isn't understandable"). Optional so /en doesn't need it.
      chart?: {
        usedLabel: string;
        rolloverLabel: string;
        months: { label: string; used: number; rollover: number }[];
      };
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
    updated: string;
    privacySections: { title: string; body: string }[];
    termsSections: { title: string; body: string }[];
  };
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
    searchNoResults: string;
    // /he redesign new UI chrome (design_handoff_ankora_redesign/README.md, "10. Coverage"):
    // the live "N domains / M services" counter labels and the empty-state CTA button.
    // Optional so /en (unchanged design, no counter/CTA button in that layout) doesn't need them.
    areaCountLabel?: string;
    serviceCountLabel?: string;
    emptyStateCta?: string;
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

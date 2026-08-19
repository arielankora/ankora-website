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
    title: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    definitionPre: string;
    definitionLinked: string;
    definitionPost: string;
  };
  problem: { label: string; title: string; body: string };
  insight: { label: string; title: string; body: string };
  category: { label: string; title: string; body: string };
  howItWorks: {
    label: string;
    title: string;
    sub: string;
    steps: { title: string; body: string }[];
  };
  intelligence: {
    label: string;
    title: string;
    body: string;
    pillars: { title: string; body: string }[];
  };
  capabilities: {
    label: string;
    title: string;
    sub: string;
    items: { title: string; body: string }[];
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
  howItWorks: SimplePageContent & { vignette: { title: string; body: string } };
  technology: SimplePageContent;
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
    };
    tiers: {
      label: string;
      title: string;
      sub: string;
      items: { name: string; hours: string; rate: string; blurb: string; highlighted: boolean }[];
      footnote: string;
    };
    closing: { title: string; body: string; cta: string };
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

export type Locale = "he" | "en";

export interface Dictionary {
  meta: {
    title: string;
    description: string;
  };
  nav: {
    solutions: string;
    howItWorks: string;
    technology: string;
    about: string;
    cta: string;
    solutionsMenu: { label: string; blurb: string; href: string }[];
  };
  hero: {
    eyebrow: string;
    title: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
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
  about: SimplePageContent & { principles: { title: string; body: string }[] };
  solutionsIndex: { eyebrow: string; title: string; sub: string };
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
}

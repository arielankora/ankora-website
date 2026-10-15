import type { Gated, SecurityGate } from "./gates";

export interface SecurityCard {
  key: string;
  title: string;
  intro: Gated[];
  points?: Gated[];
}

export interface SecurityVendor {
  name: string;
  role: string;
  location: string;
  policyUrl: string;
  gate?: SecurityGate;
}

export interface SecurityPageContent {
  meta: { title: string; description: string };
  breadcrumb: string;
  eyebrow: string;
  title: string;
  sub: string;
  chips: Gated[];
  handover: { label: string; title: string; cards: SecurityCard[] };
  ai: {
    label: string;
    title: string;
    body: string;
    seesTitle: string;
    sees: Gated[];
    neverTitle: string;
    never: Gated[];
    commitments: { title: string; body: string; gate?: SecurityGate }[];
  };
  people: {
    label: string;
    title: string;
    items: { title: string; body: string; gate?: SecurityGate }[];
    offboarding: { title: string; body: string };
  };
  platform: { label: string; title: string; items: { title: string; body: string }[] };
  standards: { label: string; title: string; body: string; items: string[]; dpaLink: string };
  vendors: {
    label: string;
    title: string;
    body: Gated[];
    head: { name: string; role: string; location: string; policy: string };
    policyLink: string;
    rows: SecurityVendor[];
  };
  incident: { label: string; title: string; body: string };
  review: {
    label: string;
    title: string;
    lastReview: string;
    updated: string;
    changelogTitle: string;
    changelog: { date: string; change: string }[];
  };
  documents: {
    label: string;
    title: string;
    cards: { title: string; body: string; href?: string; gate?: SecurityGate }[];
    disclosureTitle: string;
    disclosureBody: string;
    disclosureEmail: string;
  };
  faq: { label: string; title: string; items: { q: string; a: string; gate?: SecurityGate }[] };
  cta: { title: string; body: string };
}

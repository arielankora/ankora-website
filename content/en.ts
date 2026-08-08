import type { Dictionary } from "./types";

const en: Dictionary = {
  meta: {
    title: "Ankora — Operational Intelligence",
    description:
      "Ankora combines AI orchestration with dedicated human Operations Managers to remove the operational weight of modern life.",
  },
  nav: {
    solutions: "Who it's for",
    howItWorks: "How it works",
    technology: "Technology",
    about: "About",
    cta: "Book a call",
    solutionsMenu: [
      { label: "Executives", blurb: "Focus your attention on what actually deserves it.", href: "/solutions/executives" },
      { label: "Founders", blurb: "Grow without carrying every operational detail alone.", href: "/solutions/founders" },
      { label: "Growing Companies", blurb: "Operational infrastructure that scales with you.", href: "/solutions/companies" },
      { label: "Family Offices", blurb: "One layer of management, full peace of mind.", href: "/solutions/family-office" },
    ],
  },
  hero: {
    eyebrow: "Operational Intelligence",
    title: "You run the business.\nWho runs everything else?",
    sub: "Ankora combines AI orchestration with dedicated human Operations Managers to remove the operational complexity of modern life — so you can focus on what matters.",
    ctaPrimary: "Book a Strategy Call",
    ctaSecondary: "How it works",
  },
  problem: {
    label: "The problem",
    title: "Your success requires hundreds of decisions a day.",
    body: "Not all of them need to go through you. Small tasks — an appointment, a renewal, a booking, a follow-up — don't take much time on their own. But they never disappear. They just move from tomorrow to tomorrow, taking up space you don't notice until it's gone.",
  },
  insight: {
    label: "The insight",
    title: "You don't need more time. You need fewer things to think about.",
    body: "Mental load, not lack of time, is what actually slows down high performers. Ankora was built to remove that layer entirely — not another tool to manage, but less to manage in the first place.",
  },
  category: {
    label: "A new category",
    title: "This isn't a personal assistant. This is Operational Intelligence.",
    body: "Ankora combines AI orchestration with dedicated human Operations Managers to take full ownership of your operational complexity — not just complete tasks. We don't perform services. We buy back your time, attention, and peace of mind.",
  },
  howItWorks: {
    label: "How it works",
    title: "A process that disappears once it starts working",
    sub: "Five steps. None of them require you to manage them.",
    steps: [
      { title: "Request", body: "You share what needs to happen — in plain language, no forms, no long intake process." },
      { title: "Human Operations Manager", body: "A dedicated Operations Manager gets to know you, your preferences, and what matters to you." },
      { title: "AI Orchestration", body: "Our system coordinates, tracks, and follows up on what's needed — without being asked." },
      { title: "Execution", body: "The work is managed end to end, with full ownership, as if it were our own." },
      { title: "Proactive Update", body: "You hear from us before you have to ask — when things are on track, and when they're not." },
    ],
  },
  intelligence: {
    label: "Technology",
    title: "AI that remembers. People who decide.",
    body: "Our system remembers your preferences, schedules work, tracks progress, and flags what needs attention. Our Operations Managers bring judgment, empathy, and accountability — the parts AI shouldn't replace.",
    pillars: [
      { title: "Memory", body: "Every preference, every decision, always available — without repeating yourself." },
      { title: "Orchestration", body: "Many tasks, many parties, one transparent coordination layer." },
      { title: "Monitoring", body: "Continuous tracking of every open thread, so you don't have to check." },
      { title: "Prediction", body: "Flagging what needs attention before it becomes a problem." },
    ],
  },
  capabilities: {
    label: "Capabilities",
    title: "One operational layer, instead of a dozen open tabs",
    sub: "Every domain is owned by a dedicated Operations Manager, backed by AI orchestration.",
    items: [
      { title: "Personal Operations", body: "Your daily tasks, time, and commitments, managed in one place." },
      { title: "Vendor & Service Coordination", body: "Selection, coordination, and quality control across a vetted network." },
      { title: "Administrative Liaison", body: "Handling institutions and authorities on your behalf, start to finish." },
      { title: "Business Operations Support", body: "Ongoing operational support for small teams and growing companies." },
      { title: "Property & Household Operations", body: "Maintenance, coordination, and quality control for your home and property." },
      { title: "Travel & Logistics", body: "Planning, bookings, and changes — coordinated ahead of time." },
    ],
  },
  humanAI: {
    label: "Human + AI",
    title: "Not a replacement. A combination.",
    body: "Behind every task is a person. AI multiplies what they can do — it doesn't replace their accountability.",
    humanTitle: "Humans bring",
    human: ["Judgment", "Empathy", "Relationships", "Trust", "Decision-making"],
    aiTitle: "AI brings",
    ai: ["Memory", "Orchestration", "Automation", "Monitoring", "Prediction", "Documentation"],
  },
  industries: {
    label: "Who it's for",
    title: "Built for people whose time and attention are their most valuable resource",
    items: [
      { title: "Executives", body: "Focus on the decisions that actually require you.", href: "/solutions/executives" },
      { title: "Founders", body: "Grow without carrying every operational detail alone.", href: "/solutions/founders" },
      { title: "Growing Companies", body: "Operational infrastructure that scales with you, not against you.", href: "/solutions/companies" },
      { title: "Family Offices", body: "One management layer for the complexity of several lives.", href: "/solutions/family-office" },
    ],
  },
  trust: {
    label: "Trust",
    title: "Discretion is the default, not an add-on",
    body: "Every piece of information is handled in full confidentiality. Access is limited to those who genuinely need it, under a privacy policy built around the trust you place in us.",
    badges: ["Full privacy", "Registered Israeli business", "Human availability", "No long-term commitment"],
  },
  faq: {
    label: "FAQ",
    title: "Worth knowing before a call",
    items: [
      {
        q: "How is this different from a personal assistant?",
        a: "A personal assistant executes tasks. Ankora manages your entire operational complexity — with full ownership, persistent memory, and AI orchestration that flags what needs attention before you notice it.",
      },
      {
        q: "Who actually does the work?",
        a: "Your dedicated Operations Manager coordinates and oversees every task, often working with a vetted, quality-controlled vendor network.",
      },
      {
        q: "What does an engagement look like?",
        a: "Every engagement is scoped to your operational footprint. We map your needs on a short strategy call and propose a suitable framework — no generic price lists.",
      },
      {
        q: "What about privacy?",
        a: "Privacy is the default, not an add-on. Your information is handled in full confidentiality and never shared beyond what's required to complete the work.",
      },
      {
        q: "How do I start?",
        a: "Book a short strategy call. We'll get to know you, understand your needs, and show you exactly how Ankora would work for you.",
      },
    ],
  },
  finalCta: {
    title: "Ready to put it down?",
    body: "A twenty-minute strategy call. No commitment, no long forms.",
    cta: "Book a call",
  },
  pages: {
    howItWorks: {
      eyebrow: "How it works",
      title: "One process. Zero management on your end.",
      sub: "From the first message, Ankora takes full ownership of what needs to happen.",
      blocks: [
        { title: "Request", body: "You share what needs to happen — a message, a call, a short note. No long forms, no questionnaires." },
        { title: "Intro call", body: "Your Operations Manager gets to know you, not just the task — what matters to you, what bothers you, which decisions you want us to make on your behalf." },
        { title: "Planning", body: "We research, compare, and bring you a clear recommendation — not a long list to sort through yourself." },
        { title: "Execution & AI orchestration", body: "The task is managed end to end. Our AI tracks it, follows up, and flags delays — so nothing falls through the cracks." },
        { title: "Proactive update & follow-up", body: "You hear from us at the moments that matter, not every small step. A few days after completion, we check that everything landed well." },
      ],
      vignette: {
        title: "One day, without you noticing",
        body: "A passport renewed, a vendor coordinated, a flight rebooked in time, a gift that arrived on the right day — four completely different tasks, coordinated by the same operational layer, without you having to remember any of them.",
      },
    },
    technology: {
      eyebrow: "Technology",
      title: "The layer that remembers you, so you don't have to explain again.",
      sub: "Our system isn't a chatbot executing commands. It's an orchestration layer connecting your request, your Operations Manager, and the execution network — with persistent memory that stays with you.",
      blocks: [
        { title: "Persistent memory", body: "Every preference you've shared, every decision you've made, is stored and used the next time — without repeating yourself." },
        { title: "Multi-party orchestration", body: "When a task touches several vendors or parties, the system coordinates between them and keeps information consistent everywhere." },
        { title: "Monitoring & prediction", body: "The system tracks every open thread and flags what's about to slip — before it becomes your problem." },
        { title: "A human in the loop, always", body: "Financial, sensitive, or exceptional decisions always go through a person. AI prepares — it doesn't decide for you." },
      ],
    },
    about: {
      eyebrow: "About",
      title: "We exist to give busy people back their most valuable resource.",
      sub: "Not time. Attention.",
      blocks: [
        { title: "Vision", body: "The world is full of small tasks that together create enormous mental load. We believe people shouldn't have to carry that load alone." },
        { title: "Mission", body: "To give people managing a lot — a business, a family, a career — one operational layer they can trust completely." },
      ],
      principles: [
        { title: "Reliability above all", body: "If we committed to it, we deliver. If there's a delay, you hear it from us before you ask." },
        { title: "Full ownership", body: "Every task belongs to us until it's complete. There's no 'that's not my responsibility.'" },
        { title: "Initiative", body: "We don't wait to be asked. We think ahead, spot issues, and propose solutions." },
        { title: "Discretion", body: "We're trusted with your personal and business life. Every piece of information stays fully confidential." },
      ],
    },
    solutionsIndex: {
      eyebrow: "Who it's for",
      title: "One operational layer, matched to your kind of complexity",
      sub: "Four kinds of clients. The same principle: you focus on what matters, we manage everything else.",
    },
    contact: {
      eyebrow: "Book a call",
      title: "Let's talk for twenty minutes",
      sub: "No commitment, no long forms. We'll get to know you, understand your needs, and show you how Ankora could work for you.",
      nameLabel: "Full name",
      emailLabel: "Email",
      companyLabel: "Company (optional)",
      messageLabel: "How can we help?",
      submit: "Send & book a call",
      directTitle: "Or directly",
      directBody: "Write to us and we'll respond within one business day.",
      successMessage: "Thank you! We've received your message and will get back to you soon.",
      errorMessage: "Something went wrong sending this. Please try again, or email us directly at info@ankora.co.il.",
    },
    legal: {
      privacyTitle: "Privacy Policy",
      termsTitle: "Terms of Use",
      placeholder: "The full document is in preparation. For privacy or data security questions, please contact us directly.",
    },
    segments: {
      executives: {
        eyebrow: "Executives",
        title: "Focus on the decisions that actually require you.",
        sub: "Your success requires hundreds of decisions a day. Not all of them need to go through you.",
        bullets: [
          { title: "Time & commitment management", body: "A calendar, reminders, and follow-up that don't require you to remember." },
          { title: "Administrative liaison", body: "With authorities, banks, and institutions — without you standing in line." },
          { title: "Personal & family coordination", body: "Handled separately, without spilling into your business day." },
        ],
        closing: "One Operations Manager who knows your pace.",
      },
      founders: {
        eyebrow: "Founders",
        title: "Grow without carrying every operational detail alone.",
        sub: "In the early stages you do everything. Ankora gives you an operational layer without hiring another role.",
        bullets: [
          { title: "Ongoing operations", body: "What steals time from product and team gets managed elsewhere." },
          { title: "Vendor coordination", body: "From a vetted network, without burning time on comparisons." },
          { title: "Full flexibility", body: "Scales up and down with what the company needs right now." },
        ],
        closing: "Operational infrastructure that grows with you.",
      },
      companies: {
        eyebrow: "Growing Companies",
        title: "Operational infrastructure that scales with you, not against you.",
        sub: "Fast growth creates operational complexity no job description covers.",
        bullets: [
          { title: "Ongoing operational support", body: "For small teams that need more without hiring more." },
          { title: "Vendor & procurement management", body: "Comparison, coordination, and quality control in one place." },
          { title: "Reporting & clarity", body: "See what's in progress, what's done, and what needs attention." },
        ],
        closing: "An operational layer you can trust while growing fast.",
      },
      familyOffice: {
        eyebrow: "Family Offices",
        title: "One management layer for the complexity of several lives.",
        sub: "Several properties, several family members, dozens of vendors — one place managing all of it.",
        bullets: [
          { title: "Property operations", body: "Maintenance, vendors, and quality control across several properties at once." },
          { title: "Family coordination", body: "Events, travel, and commitments — coordinated with full transparency." },
          { title: "Absolute discretion", body: "Limited access, full documentation, confidentiality by default." },
        ],
        closing: "Peace of mind that covers more than one domain.",
      },
    },
  },
  footer: {
    tagline: "Operational Intelligence that gives you back time.",
    rights: "All rights reserved",
    privacy: "Privacy",
    terms: "Terms",
  },
};

export default en;

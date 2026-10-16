import type { SecurityPageContent } from "./types";

const security: SecurityPageContent = {
  meta: {
    title: "Security and Trust | Ankora",
    description:
      "How Ankora protects what you hand over: an encrypted credentials vault with on-device verification, server-side client isolation, AI that never sees passwords, a full audit log and every vendor named.",
  },
  breadcrumb: "Security and Trust",
  eyebrow: "Security and Trust",
  title: "Trust is part of the product.",
  sub: "To run your operations, you give us access to things you give no one else. So every piece of that access is encrypted, limited to the people who need it, and logged.",
  chips: [
    { text: "AES-256 encryption for every password" },
    { text: "On-device verification before every view" },
    { text: "Two-step sign-in for every staff login" },
    { text: "Every action is logged" },
    { text: "Your data never trains models", gate: "openaiTier" },
  ],

  handover: {
    label: "What you hand over",
    title: "What you give us, and what happens to it.",
    cards: [
      {
        key: "01 · ACCESS",
        title: "Your passwords don't travel over WhatsApp.",
        intro: [
          {
            text: "Credentials for your systems live in a dedicated vault. Not in messages, not in documents, not in personal password managers.",
          },
        ],
        points: [
          { text: "Each record is encrypted on its own with AES-256-GCM, under a key that is not stored in the database and not included in backups." },
          { text: "Only people assigned to your account can see that a record exists." },
          { text: "Every password view requires identity verification on the Operations Manager's own device: fingerprint, face or Windows Hello." },
          { text: "The password is shown for 30 seconds, then disappears." },
          { text: "Every view is logged with who, when and for which task. Blocked attempts are logged too." },
          { text: "You can ask for the list of views of your credentials at any time." },
          { text: "A request to delete credentials is handled within one business day. When the engagement ends, they are deleted within three business days." },
        ],
      },
      {
        key: "02 · DATA",
        title: "You see only your own. Technically, too.",
        intro: [
          {
            text: "Your portal identifies your account from the user's assignment on the server, not from anything that can be changed in a browser. One user cannot reach another client's data, even on purpose. Data is encrypted in transit and at rest, and the client area is closed to search engines. You can turn on two-step sign-in for your own portal access too.",
          },
        ],
      },
      {
        key: "03 · CALLS",
        title: "We take notes, so you never repeat yourself.",
        intro: [
          {
            text: "Working calls are recorded and transcribed. That is how every commitment enters the system, and how a change of Operations Manager doesn't reset the context.",
          },
          {
            text: "Transcripts are kept with business-tier vendors only, and are never used to train models.",
            gate: "firefliesTier",
          },
        ],
      },
    ],
  },

  ai: {
    label: "AI, in the open",
    title: "The AI remembers. It doesn't decide, and it doesn't see everything.",
    body: "Our AI systems summarize calls, track commitments and flag what is about to slip. Decisions stay with people.",
    seesTitle: "What the AI sees",
    sees: [
      { text: "Transcripts of working calls" },
      { text: "Tasks, updates and notes" },
      { text: "Documents your Operations Manager passes to it as part of a task" },
    ],
    neverTitle: "What the AI never sees",
    never: [
      {
        text: "Usernames and passwords for your systems. It has no technical path to them, and an automated check stops any change that would open one.",
      },
      { text: "Tasks and materials you asked us to keep away from AI.", gate: "noAi" },
    ],
    commitments: [
      {
        title: "No training.",
        body: "We work with Anthropic and OpenAI on paid plans only, and every account is set so your data is never used to train models.",
        gate: "openaiTier",
      },
      {
        title: "A person approves.",
        body: "Anything that leaves the system, a message, a payment or a booking, is approved by your Operations Manager.",
      },
      {
        title: "You decide.",
        body: "Ask, and a task or a document never passes through an AI system at all. It is marked that way and handled by people only.",
        gate: "noAi",
      },
    ],
  },

  people: {
    label: "The people",
    title: "Few people, each named, each with limited access.",
    items: [
      { title: "A personal account for everyone.", body: "No shared users. Every action is tied to the person who took it." },
      {
        title: "Two-step sign-in, every time.",
        body: "Everyone at Ankora signs in with a password and a confirmation on their own device: fingerprint or face. A password alone does not open the system.",
      },
      {
        title: "Access by assignment.",
        body: "An Operations Manager sees only the clients assigned to them. Any other client simply doesn't exist for them.",
      },
      {
        title: "Confidentiality in writing.",
        body: "Everyone who touches your data has signed a personal confidentiality undertaking.",
        gate: "confidentiality",
      },
    ],
    offboarding: {
      title: "When someone leaves, their access doesn't stay.",
      body: "Their permissions are revoked in our system at once, and every open session is closed. Access to external tools is closed within three business days. And you receive from us a list of every credential of yours they viewed in the last 90 days, so you can rotate them.",
    },
  },

  platform: {
    label: "The platform",
    title: "Under the hood.",
    items: [
      {
        title: "Encryption",
        body: "TLS on every access path, with HSTS. Encryption at rest in the database. User passwords are stored as bcrypt hashes, and reset links are single-use and expire.",
      },
      {
        title: "Audit log",
        body: "Every material action is logged with who, when, the state before and after, IP address and browser. Time entries keep a full version history.",
      },
      { title: "Client isolation", body: "The client's identity is derived on the server from the user's assignment, on every request." },
      {
        title: "Hardening",
        body: "A dedicated content security policy for the client area with no third-party source at all. Rate limiting on sign-in and on every sensitive entry point.",
      },
      {
        title: "Backup",
        body: "A full backup every night. The restore script is tested automatically on every code change, and a full restore drill runs every quarter. Backups are deleted after 35 days.",
      },
      {
        title: "Reviews",
        body: "A monthly security review against the OWASP Top 10, and continuous tracking of vulnerable dependencies. Every finding is recorded with a severity and a fix date.",
      },
    ],
  },

  standards: {
    label: "Standards and regulation",
    title: "Built to work with your legal counsel.",
    body: "When you pass personal data to us, the legal responsibility stays with you. Our Data Processing Addendum is written so you can meet it. We work to:",
    items: [
      "Israel's Protection of Privacy Law, including Amendment 13",
      "The Protection of Privacy (Data Security) Regulations, 2017",
      "GDPR Article 28, for clients with activity in the EU",
      "OWASP Top 10, in development and in reviews",
    ],
    dpaLink: "Read the Data Processing Addendum",
  },

  vendors: {
    label: "Who else processes data",
    title: "Every vendor, by name.",
    body: [
      {
        text: "The application and the database are hosted in the United States. Email and documents are kept on Google Workspace's global infrastructure.",
      },
      { text: "We have a written data processing agreement with every vendor.", gate: "vendorDpas" },
      { text: "You will be notified before any new vendor is added." },
    ],
    head: { name: "Vendor", role: "Role", location: "Location", policy: "Privacy policy" },
    policyLink: "View policy",
    rows: [
      { name: "Vercel", role: "Website and application hosting", location: "United States", policyUrl: "https://vercel.com/legal/privacy-notice" },
      { name: "Neon", role: "Database", location: "United States", policyUrl: "https://www.databricks.com/legal/privacynotice" },
      { name: "Upstash", role: "Rate limiting", location: "United States", policyUrl: "https://upstash.com/trust/privacy.pdf" },
      { name: "Resend", role: "Email delivery", location: "United States", policyUrl: "https://resend.com/legal/privacy-policy" },
      { name: "Google Workspace", role: "Email, documents and backups", location: "Global", policyUrl: "https://policies.google.com/privacy" },
      { name: "ClickUp", role: "Work management", location: "United States", policyUrl: "https://clickup.com/terms/privacy" },
      { name: "Fireflies", role: "Call transcription", location: "United States", policyUrl: "https://fireflies.ai/privacy-policy" },
      { name: "Anthropic", role: "AI (Claude)", location: "United States", policyUrl: "https://www.anthropic.com/legal/privacy" },
      { name: "OpenAI", role: "AI", location: "United States", policyUrl: "https://openai.com/policies/privacy-policy/", gate: "openaiTier" },
      { name: "Google Analytics", role: "Marketing site measurement", location: "Global", policyUrl: "https://policies.google.com/privacy" },
    ],
  },

  incident: {
    label: "When something goes wrong",
    title: "You hear from us within 24 hours.",
    body: "If we discover a security incident that touches your data, we notify you within 24 hours of learning about it, without waiting for the investigation to finish. You get what happened, which data may be involved, what we have already done, and what we recommend you do. We also report to the Privacy Protection Authority where the law requires it.",
  },

  review: {
    label: "Freshness",
    title: "When we last checked.",
    lastReview: "Last security review: October 2026",
    updated: "Page last updated: October 2026",
    changelogTitle: "Changelog",
    changelog: [
      { date: "October 2026", change: "Two-step sign-in, required for all staff and available to clients" },
      { date: "October 2026", change: "On-device verification before every password view" },
      { date: "October 2026", change: "Encrypted credentials vault, with every view logged" },
      { date: "October 2026", change: "Full nightly backup with an automated restore test" },
      { date: "September 2026", change: "Audit log with IP address and browser for every action" },
      { date: "September 2026", change: "Data Processing Addendum published" },
    ],
  },

  documents: {
    label: "Documents",
    title: "Everything is written down, and available.",
    cards: [
      { title: "Data Processing Addendum (DPA)", body: "What we commit to, in legal language.", href: "/dpa" },
      { title: "Privacy policy", body: "What data is collected, why, and how long it is kept.", href: "/privacy" },
      {
        title: "Completed security questionnaire",
        body: "For your vendor review. Sent on request.",
        gate: "questionnaire",
      },
    ],
    disclosureTitle: "Found a security issue?",
    disclosureBody: "Write to us. We acknowledge receipt within one business day.",
    disclosureEmail: "security@ankora.co.il",
  },

  faq: {
    label: "Questions",
    title: "What people usually ask us.",
    items: [
      {
        q: "Who at Ankora can see my passwords?",
        a: "Only people assigned to your account, and only after verification on their own device. Every view is logged, and you can ask for the list.",
      },
      {
        q: "Is my data used to train AI models?",
        a: "No. We work only on paid plans, and every account is set so data is never used for training. Credentials never reach an AI system at all.",
        gate: "openaiTier",
      },
      {
        q: "Where is my data stored?",
        a: "The application and the database are hosted in the United States, and email and documents in Google Workspace. Every vendor is named on this page.",
      },
      {
        q: "What happens to my data when the engagement ends?",
        a: "Credentials are deleted within three business days. Everything else is available for export for 30 days and deleted within 60 days, with a closing report.",
      },
      {
        q: "Can I get a signed data processing agreement?",
        a: "Yes. Our DPA applies to every client, and we can provide a signed copy for your vendor file.",
      },
    ],
  },

  cta: {
    title: "Have a question we didn't answer?",
    body: "We'll go through it on the intro call, together with whoever handles security on your side.",
  },
};

export default security;

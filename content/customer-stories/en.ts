import type { CustomerStory } from "./types";

/** English customer stories, newest first. Same publishing rule as the Hebrew file:
 *  evidence only. */
const stories: CustomerStory[] = [
  {
    slug: "gilad-komorov",
    locale: "en",
    customerName: "Gilad Komorov",
    customerRole: "3X CRO | Revenue Architect | GTM Advisor",
    customerType: "executive",
    headline: "Transferring responsibility - not just tasks",
    summary: "How Gilad reduced his operational load and reclaimed time for high-value work.",
    sections: [
      {
        kind: "context",
        body: [
          "Gilad Komorov helps companies build their revenue engine - a role where his value sits in strategic work with leadership and sales teams, not in the operational running that surrounds it.",
        ],
      },
      {
        kind: "problem",
        body: [
          "As with many senior executives, the load did not come from one large task. It came from dozens of small open ends - coordination, vendors, administration, follow-up - each too short to justify delegating, and collectively expensive in hours and attention.",
        ],
      },
      {
        kind: "why-alternatives-fell-short",
        body: [
          "A full-time personal assistant was more than the volume required, and splitting the work across several providers handed the management back to him: someone still had to hold the full picture, chase, and close.",
        ],
      },
      {
        kind: "ankora-approach",
        body: [
          "Rather than handing over individual tasks, Gilad handed over responsibility. A dedicated Ankora Operations Manager owns the agreed areas end to end - including the small decisions and the follow-up in between - and comes back to him only when a decision is genuinely his to make.",
        ],
      },
      {
        kind: "how-the-work-is-managed",
        body: [
          "The work runs through one consistent person rather than a rotating desk, supported by technology and AI tools the Operations Manager uses for tracking, prioritisation and coordination. Judgement and accountability stay with a human.",
        ],
      },
      {
        kind: "outcome",
        body: [
          "Day-to-day operational load came down and fewer open loops required his attention, freeing time for the work where he creates the most value.",
        ],
      },
    ],
    areasManaged: ["coordination", "vendors", "administration", "follow-up"],
    outcomes: ["reduced-operational-load", "fewer-open-loops", "end-to-end-ownership", "time-saved"],
    independentEvidence: {
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7507368372758536192/",
      label: "Gilad Komorov's post on LinkedIn",
      type: "LinkedIn",
    },
    image: {
      src: "/customer-stories/gilad-komorov.png",
      alt: "Gilad Komorov",
    },
    relatedSolutions: [
      "/personal-operations-management",
      "/solutions/executives",
      "/ankora-vs-personal-assistant",
    ],
    publishedDate: "2026-09-21",
  },
];

export default stories;

import type { LegalContent } from "../types";

/**
 * The five legal documents, generated from the approved source and kept in one
 * place so a change to a clause is a change in exactly one file.
 *
 * Section ids are explicit and shared between the locales, so /he/privacy#recording
 * and /en/privacy#recording are the same clause and a link filed in a contract keeps
 * pointing at it even when sections are reordered. Never rename an id in use.
 */
const legal: LegalContent = {
  updated: "Last updated: September 2026",
  updatedISO: "2026-09",
  contentsLabel: "Contents",
  tableLabel: "Table",
  pages: {
    terms: {
      title: "Website Terms of Use",
      sub: "This document applies to the website only. The service itself is governed by the Service Terms and by the individual engagement agreement.",
      sections: [
        {
          id: "who-we-are",
          title: "Who we are",
          body: [
            "Ankora is an AI-powered operational management company. The website is operated by ANKORA 360 LTD, company registration number 517395471.",
          ],
        },
        {
          id: "use-of-the-site",
          title: "Use of the site",
          body: [
            "Using the site constitutes acceptance of these terms. Anyone who does not accept them is welcome not to use the site.",
            "The site is intended for reasonable business and personal use. It may not be used to impair its availability, to attempt to reach areas that are not open to the public, to collect information from it by automated means, or to display it within another site in a misleading way.",
          ],
        },
        {
          id: "client-area",
          title: "Client area",
          body: [
            "Part of the site is open to clients only and requires an account. The account is personal. Safeguarding the login credentials, and every action taken under the account, is the account holder's responsibility. If misuse is suspected, notify us immediately at hello@ankora.co.il.",
          ],
        },
        {
          id: "site-content",
          title: "Site content",
          body: [
            "The content on the site, including blog posts and calculators, is provided as general information. It is not legal, tax, insurance, investment or medical advice, and it should not be relied on as a substitute for professional advice. Results produced by the ROI calculator are an estimate based on the figures entered by the user, and are not a commitment to any outcome.",
          ],
        },
        {
          id: "intellectual-property",
          title: "Intellectual property",
          body: [
            "The design, the code, the text, the mark and the name Ankora are the property of the company. Short excerpts from the blog may be quoted with a link to the source. Any other use requires prior written permission.",
          ],
        },
        {
          id: "availability-and-changes",
          title: "Availability and changes",
          body: [
            "We aim for continuous availability but do not undertake to provide it. We may change the site and these terms. A material change will be published on this page.",
          ],
        },
        {
          id: "liability",
          title: "Liability",
          body: [
            "The site is offered as is. Nothing in this section derogates from rights that cannot be waived under applicable law, and in particular under the Israeli Consumer Protection Law. Liability relating to the service itself is governed by the Service Terms.",
          ],
        },
        {
          id: "governing-law-and-jurisdiction",
          title: "Governing law and jurisdiction",
          body: [
            "The laws of the State of Israel. Exclusive jurisdiction is granted to the courts of the Tel Aviv district.",
          ],
        },
        {
          id: "contact",
          title: "Contact",
          body: [
            "hello@ankora.co.il",
          ],
        },
      ],
    },
    privacy: {
      title: "Privacy Policy",
      sub: "Clients give Ankora access to parts of their lives. This document explains what we see, what we do with it, and what we do not do. We wrote it to be read, not to shield us.",
      sections: [
        {
          id: "who-is-responsible-for-the-information",
          title: "1. Who is responsible for the information",
          body: [
            "The owner of the database and the party responsible for the processing is ANKORA 360 LTD, company registration number 517395471. Privacy enquiries: hello@ankora.co.il.",
            "Where Ankora carries out tasks for a business client and is exposed to information about that client's employees, customers or suppliers, the client is the owner of the database and Ankora acts as holder of the database on its behalf. This relationship is governed in full by the engagement agreement.",
          ],
        },
        {
          id: "what-information-we-receive",
          title: "2. What information we receive",
          body: [
            "**From site visitors.** Details submitted through the contact form: name, phone, email and the content of the enquiry. In addition, technical usage data and IP address.",
            "**From clients.** Contact and billing details, portal user details, time entries and task descriptions, and any operational material required to carry out the task: correspondence, calendar, documents, supplier details and personal preferences.",
            "**From systems the client opens to us.** When a client grants us access to their mailbox, calendar, accounting system, CRM or office computer, we are exposed to the information held there. We access only what the task requires.",
            "**From calls and meetings.** See section 5.",
            "We do not ask for sensitive information that the task does not require. Where the client provides us with sensitive information for the purpose of a task, for example handling a matter with a health fund, that information is used for that task alone and is not retained beyond what the task requires.",
          ],
        },
        {
          id: "what-we-do-with-the-information",
          title: "3. What we do with the information",
          body: [
            "To deliver the service and to coordinate with third parties on the client's behalf. To bill and to manage the engagement. To maintain continuous operational context, so that we do not ask the same question twice. To improve the quality of execution. To meet legal obligations.",
            "We do not sell information, do not rent it, and do not transfer it to a third party for that party's own marketing.",
          ],
        },
        {
          id: "access-to-the-client-s-accounts-and-systems",
          title: "4. Access to the client's accounts and systems",
          body: [
            "This is the part most worth reading.",
            "Access is granted by the client alone, explicitly, and to the systems the client names. The scope of the authorization is documented in writing.",
            "Tasks are carried out within the scope that was defined. We do not read material that the task does not require, even where it is technically accessible.",
            "On termination of the engagement, or when an operations manager changes, Ankora revokes the permissions under its control within three business days and notifies the authorized contact at the client. Permissions granted inside the client's own systems are under the client's control, and the client is to revoke them on its side.",
          ],
        },
        {
          id: "recording-documentation-and-monitoring",
          title: "5. Recording, documentation and monitoring",
          body: [
            "**Calls and meetings with our team are recorded and transcribed, and actions taken by the operations manager inside client systems are logged.**",
            "This is not a mechanism for monitoring the client. It is what allows us not to ask the same question twice, to hand a task from one person to another without context falling away, and to improve the quality of the work. The record also serves as input to our AI systems as described in section 6.",
            "Recordings are kept under restricted access and are deleted at the client's request. A client who prefers that their calls not be recorded may ask, and we will honor the request.",
            "Where a call includes additional participants, we give notice of the recording at the start of the call, to the extent required by applicable law.",
          ],
        },
        {
          id: "ai-what-it-does-and-what-it-does-not",
          title: "6. AI: what it does and what it does not",
          body: [
            "Ankora integrates AI systems into the operational layer. They summarize, classify, retrieve information, prepare drafts, document, and flag matters that may otherwise slip.",
            "**A decision made towards the client is always made by a person.** There is no situation in which a system decides on its own to act towards a third party, to make a payment, or to change a commitment of the client.",
            "**Ankora does not train models on client information.** Neither models of our own nor models of others. We work with AI providers under business terms in which the provider is contractually prohibited from training models on the data that passes through us.",
            "The data that passes to the AI systems is limited to what the task requires. We work with leading AI tools such as Anthropic or OpenAI.",
          ],
        },
        {
          id: "sub-processors",
          title: "7. Sub-processors",
          body: [
            "Ankora relies on leading international infrastructure providers, the same providers the world's leading software companies rely on. Each of them processes information for us for one defined purpose, and is bound by contractual information security and confidentiality undertakings. The list is maintained on the security and trust page, where links to each provider's privacy policy also appear.",
          ],
          table: {
            head: ["Provider", "Purpose of processing", "Type of information", "Country"],
            rows: [
              ["Vercel", "Hosting the site and the client area", "Technical usage data", "United States"],
              ["Neon", "Database of the operations system", "Operational client data", "United States"],
              ["Upstash", "Protection against abuse of the system", "Technical usage data", "United States"],
              ["Resend", "Sending messages from the system", "Contact details and message content", "United States"],
              ["Google Workspace", "Email, calendar and document storage", "Operational correspondence and documents", "Global"],
              ["ClickUp", "Task management and tracking", "Operational client data", "United States"],
              ["Fireflies", "Transcription and summary of calls", "Recordings and transcripts", "United States"],
              ["Anthropic", "The operational AI layer", "Operational client data", "United States"],
              ["Google Analytics", "Measurement of use of the marketing site", "Anonymous usage data", "Global"],
            ],
          },
        },
        {
          id: "transfer-of-information-outside-israel",
          title: "8. Transfer of information outside Israel",
          body: [
            "The service relies on leading international tools, and the information is therefore stored on their servers in the United States, in line with the standards under which the world's leading software companies operate. These are the same providers used by the largest companies in the world, and the engagement with each of them includes information security and confidentiality undertakings.",
          ],
        },
        {
          id: "retention-and-deletion",
          title: "9. Retention and deletion",
          body: [
            "Operational information is retained for as long as the engagement is active. Within thirty days of the end of the engagement the client may receive a full export of their data.",
          ],
        },
        {
          id: "rights",
          title: "10. Rights",
          body: [
            "Under the Israeli Privacy Protection Law and Amendment 13 to it, and under the GDPR for those to whom it applies: to review the information, to correct inaccurate information, to request deletion, to object to processing, and to receive a portable copy.",
            "Write to hello@ankora.co.il. We will respond within thirty days.",
            "Where the request concerns information we received from a business client, for example an employee of a client, we will pass the request on to the client and assist them in handling it, because the information is theirs.",
          ],
        },
        {
          id: "information-security",
          title: "11. Information security",
          body: [
            "Encryption in transit and at rest, permissions on a need basis, structural separation between clients in the portal, an audit log, and periodic security reviews. The detail is set out on the security and trust page.",
            "In the event of a serious security incident, we will notify the affected clients and the Israeli Privacy Protection Authority as required by law, without waiting for a full investigation.",
          ],
        },
        {
          id: "cookies",
          title: "12. Cookies",
          body: [
            "The marketing site uses essential cookies and Google Analytics measurement cookies. They can be blocked through the browser without impairing use of the site.",
            "The client area contains no third-party resources and no tracking cookies. Only the session cookie.",
          ],
        },
        {
          id: "minors",
          title: "13. Minors",
          body: [
            "The service is intended for adults and is conducted with the client only. Where a client asks us to carry out a task concerning their children, the request itself constitutes the client's authorization to provide the information required for that task, in accordance with applicable law. The information is used for that task alone.",
          ],
        },
        {
          id: "changes",
          title: "14. Changes",
          body: [
            "Ankora may update this policy from time to time. The current version is published on this page.",
          ],
        },
      ],
    },
    service: {
      title: "Service Terms",
      sub: "This document is the standing annex that the service proposal refers to. The proposal sets the commercial terms: scope, price, term. This document sets everything else. In the event of a conflict, the proposal prevails.",
      sections: [
        {
          id: "what-ankora-does",
          title: "1. What Ankora does",
          body: [
            "Ankora provides a dedicated operations manager, supported by AI systems and by a management layer, who takes responsibility for operational matters end to end.",
            "The undertaking is to manage the matter: to execute, to follow up, to clear obstacles along the way, and to come back to the client when the matter is closed or when a decision by the client is required. The undertaking is not to an outcome that depends on a third party, whether an authority, a supplier, a bank or another body.",
          ],
        },
        {
          id: "what-ankora-does-not-do",
          title: "2. What Ankora does not do",
          body: [
            "Ankora does not provide legal advice, tax advice, insurance advice or insurance marketing, investment or pension advice, property valuation, real estate brokerage, medical advice, or any other occupation that the law reserves to license holders.",
            "In these fields Ankora carries out operations only: finding a professional, coordinating meetings, collecting documents, following the handling and closing the loop. The professional judgment remains with the professional.",
            "Ankora does not present itself as holding authority on behalf of any public authority, and does not act in place of the client where the law requires the client's personal identification.",
          ],
        },
        {
          id: "authority-to-act-on-the-client-s-behalf",
          title: "3. Authority to act on the client's behalf",
          body: [
            "The client defines the scope of the authority in writing. Without such a definition, Ankora carries out only actions that do not bind the client towards a third party.",
            "**What constitutes an instruction and a written authorization.** Wherever this document refers to an instruction, an approval or a written authorization, this means any text message received from the client or from a person the client has authorized, including email, WhatsApp, SMS, Slack or a message in Ankora's system, as well as a recorded and documented voice message. The client names in advance the people authorized to give instructions on its behalf, and Ankora records every instruction and authorization in the system.",
          ],
        },
        {
          id: "financial-actions",
          title: "4. Financial actions",
          body: [
            "**A financial authorization is a choice by the client and not a default.** As long as the client has not chosen it explicitly, Ankora does not carry out financial actions on the client's behalf. A client who chooses to activate the authorization defines it in writing, and Ankora carries out payments, purchase orders and collection actions within the defined scope. These are the rules:",
            "**A per-transaction ceiling and a monthly ceiling** are set in advance by the client and at the client's responsibility. Exceeding them requires specific written approval.",
            "**The money is the client's and remains the client's.** Ankora does not hold client funds in its accounts and does not commingle client funds.",
            "**Ankora is responsible for correct execution of the instruction, and responsibility for the financial action itself is the client's.** If the client instructed a payment to a supplier, Ankora is responsible for the correct amount being paid to the correct party on time. The choice of supplier, the merit of the payment and its financial consequences are the client's responsibility. Ankora acts with care and reasonableness, and nothing in this section relieves it of liability for negligence in execution or for exceeding the authorization given to it.",
          ],
        },
        {
          id: "working-with-suppliers-three-tiers-of-responsibility",
          title: "5. Working with suppliers: three tiers of responsibility",
          body: [
            "**Direct execution.** A task Ankora performs itself. Ankora is responsible for the execution.",
            "**Supplier coordination and management.** Ankora selects a supplier, coordinates, supervises and closes the loop. Ankora is responsible for a reasonable selection and reasonable supervision, **not for the supplier's own performance and not for damage the supplier caused**.",
            "**Referral only.** Ankora presents alternatives and the client contracts directly. Ankora is not a party to that engagement.",
            "The tier that applies to each task is recorded in the system.",
          ],
        },
        {
          id: "service-hours",
          title: "6. Service hours",
          body: [
            "Regular service hours are Sunday through Thursday, between 9:00 and 18:00, Israel time. Public holidays and days of rest under the Israeli holiday calendar are not service days.",
            "The client may request activity outside these hours on a case by case basis. Ankora will make a reasonable effort to accommodate the request, and this is not an undertaking of availability outside service hours.",
            "Activity approved in advance outside regular service hours is billed at double minutes: each minute of work is charged to the hour bank as two minutes.",
          ],
        },
        {
          id: "hour-bank",
          title: "7. Hour bank",
          body: [
            "The package is purchased in advance for each month. The invoice is issued and payment is made on the 1st of the month, for that month.",
            "Payment is in advance for the month purchased, and not on net terms. Work begins after payment is received, unless the proposal provides otherwise.",
            "Billing is by actual working time and not by time present. Every entry is recorded with a description of the task and is available to the client in the portal.",
            "An unused balance rolls over to the following month as stated in the proposal. Exceeding the bank requires prior approval.",
            "Travel time, where physical attendance is required, is billed as stated in the proposal: a fixed amount for each direction, regardless of the actual travel time.",
            "Unless the proposal provides otherwise, the billed travel time is one hour for each direction.",
            "External expenses are passed on to the client at cost, with no markup.",
          ],
        },
        {
          id: "term-renewal-and-termination",
          title: "8. Term, renewal and termination",
          body: [
            "The engagement renews automatically each month unless the proposal provides otherwise.",
            "**Notice of non-renewal** is given up to seven days before the end of the month.",
            "Termination for fundamental breach is immediate, after a warning and seven days to cure.",
            "**On termination:** Ankora revokes the permissions under its control within three business days, and the client receives a full export of its data and a handover of open matters. An unused hour balance rolls over for as long as the engagement is active, and expires on termination of the engagement or on a reduction of the package, with no refund and no set-off.",
          ],
        },
        {
          id: "client-responsibilities",
          title: "9. Client responsibilities",
          body: [
            "To provide accurate and current information. To grant the required permissions and to revoke them when needed. To respond within a reasonable time when a decision is required. A task waiting on the client is not counted against Ankora.",
            "The client declares that it is entitled to provide Ankora with the information and the access, and in particular information about its employees and customers.",
          ],
        },
        {
          id: "confidentiality",
          title: "10. Confidentiality",
          body: [
            "Both parties maintain confidentiality. Each member of the Ankora team has signed a personal undertaking. The obligation survives termination of the engagement.",
          ],
        },
        {
          id: "intellectual-property",
          title: "11. Intellectual property",
          body: [
            "Deliverables created specifically for the client in the course of providing the service, such as documents, spreadsheets, presentations, supplier lists and procedures written for the client, are the client's property from the moment payment for them is made.",
            "Everything else remains Ankora's: the technology, the software, the systems and the platform, the methodology and the work scripts, the internal procedures, the prompts, the automated agents, the automations, the system configurations and the knowledge bases. This applies also to developments and improvements created or refined in the course of providing the service to the client. Nothing in this agreement grants the client any right or license in them, beyond use of the deliverables handed to the client.",
          ],
        },
        {
          id: "no-direct-hiring",
          title: "12. No direct hiring",
          body: [
            "During the engagement and within twelve months of its termination, the client will not directly employ a person made available to it by Ankora, other than with written consent. This section does not apply where the person applies on their own initiative to a position that was advertised publicly.",
            "A breach of this section entitles Ankora to liquidated damages, agreed and estimated in advance, of NIS 150,000 for each person employed in breach of it, with no need to prove damage. The parties declare that this amount was set after deliberation, and that it reflects a reasonable estimate of the damage to Ankora, including the cost of sourcing, recruiting and training and the expected loss of revenue.",
          ],
        },
        {
          id: "liability-and-its-limitation",
          title: "13. Liability and its limitation",
          body: [
            "Ankora will act with skill and reasonable care.",
            "**Cap:** Ankora's total liability will not exceed **the service fees actually paid in the twelve months preceding the event**.",
            "Ankora will not be liable for indirect or consequential damage, for loss of profits or for loss of opportunity.",
            "**The cap and the limitations do not apply** to wilful misconduct, to gross negligence, to breach of confidentiality, to bodily injury, or to any matter that the law does not permit to be limited.",
          ],
        },
        {
          id: "status-of-the-parties",
          title: "14. Status of the parties",
          body: [
            "Independent contractors. There is no employer and employee relationship between the client and the members of the Ankora team.",
          ],
        },
        {
          id: "governing-law-and-jurisdiction",
          title: "15. Governing law and jurisdiction",
          body: [
            "Israeli law. The courts of the Tel Aviv district. Before turning to a court, thirty days of good faith efforts to resolve the matter directly.",
          ],
        },
      ],
    },
    security: {
      title: "Security and Trust",
      sub: "Clients give Ankora access to parts of their lives. This page explains how we protect them. It is updated as the setup develops.",
      sections: [
        {
          id: "access-and-permissions",
          title: "Access and permissions",
          body: [
            "Each member of the Ankora team works under a personal, identified user in Ankora's systems, in a way that allows the activity to be monitored and controlled. These permissions are revoked when the person leaves Ankora.",
            "The portal is built so that separation between clients is structural: the client identity is derived from the user's assignment on the server and not from a parameter that can be changed in the browser. A user cannot reach another client's data even by deliberate attempt.",
          ],
        },
        {
          id: "encryption",
          title: "Encryption",
          body: [
            "Encryption in transit on every access path, and encryption at rest in the database. Passwords are stored as bcrypt hashes and not in plain text. Password reset tokens are single use and expiring.",
          ],
        },
        {
          id: "audit-log",
          title: "Audit log",
          body: [
            "Material actions in the system are recorded with the actor, the time, the entity, the state before and after, the IP address and the browser. Time entries are kept with a full version history, so that it is possible to reconstruct who changed what and when.",
          ],
        },
        {
          id: "application-hardening",
          title: "Application hardening",
          body: [
            "A dedicated CSP policy for the client area, with no third-party source at all. Shared rate limiting across all login and contact endpoints. Constant time comparison for sensitive comparisons. The client area is blocked from search engine indexing.",
          ],
        },
        {
          id: "reviews-and-testing",
          title: "Reviews and testing",
          body: [
            "A documented periodic security review, including mapping against the OWASP Top 10 and tracking of vulnerable dependencies. Findings are documented with a severity and a remediation date.",
          ],
        },
        {
          id: "where-the-information-sits",
          title: "Where the information sits",
          body: [
            "The infrastructure is hosted in the United States. The full sub-processor list appears in the privacy policy, section 7.",
          ],
        },
        {
          id: "incident-response",
          title: "Incident response",
          body: [
            "In the event of a serious security incident: we will notify the affected clients and the Israeli Privacy Protection Authority as required by law, without waiting for a full investigation.",
          ],
        },
        {
          id: "questions",
          title: "Questions",
          body: [
            "hello@ankora.co.il",
          ],
        },
      ],
    },
    dpa: {
      title: "Data Processing Addendum",
      sub: "This addendum applies where Ankora is exposed to personal data for which the client is responsible, for example data about the client's employees, customers or suppliers. It is a standing annex to the engagement agreement, and it is designed to let the client meet its own obligations under regulation 15 of the Israeli Privacy Protection (Data Security) Regulations, and under the GDPR for those to whom it applies.",
      sections: [
        {
          id: "status-of-the-parties",
          title: "1. Status of the parties",
          body: [
            "The client is the owner of the database and the party that determines the purposes of the processing. Ankora is the holder of the database and processes the data on the client's behalf.",
            "Ankora processes personal data only on the client's documented instructions and for the purpose of providing the service. What constitutes an instruction and a written authorization is defined in the Service Terms, section 3.",
            "If Ankora believes that an instruction from the client conflicts with applicable law, it will say so and will not carry it out until the matter is clarified.",
          ],
        },
        {
          id: "categories-of-data-and-purpose-of-processing",
          title: "2. Categories of data and purpose of processing",
          body: [
            "The sole purpose of the processing is providing the service. Ankora does not process the data for any other purpose, does not sell it, and does not use it for its own ends.",
          ],
          table: {
            head: ["Type of data", "Data subjects", "Purpose of processing"],
            rows: [
              ["Contact details", "The client's employees, customers and suppliers", "Coordination, communication and task execution"],
              ["Correspondence and calendar", "The client and those corresponding with the client", "Carrying out operational tasks and maintaining context"],
              ["Operational and accounting documents", "The client, its suppliers and its customers", "Issuing, collecting and tracking"],
              ["Payment and billing details", "The client's suppliers", "Making payments under authorization"],
              ["Recordings and transcripts", "Participants in the call", "Documentation, continuity of context and quality"],
              ["Sensitive data, only where provided for a task", "As defined in the instruction", "That task alone"],
            ],
          },
        },
        {
          id: "scope-of-access-and-systems",
          title: "3. Scope of access and systems",
          body: [
            "The client specifies in writing the systems to which access is granted, the scope of that access, and the actions Ankora may perform in each system: view only, update, or create new records.",
            "Access is granted to identified individuals only. Each member of the Ankora team works under a personal, identified user in Ankora's systems, in a way that allows the activity to be monitored and controlled.",
            "Every material action is recorded in an audit log with the actor, the time, the entity and the state before and after.",
            "Ankora does not access data that the task does not require, even where it is technically accessible. The list of people holding permissions is available to the client on request.",
          ],
        },
        {
          id: "confidentiality",
          title: "4. Confidentiality",
          body: [
            "Every person acting on Ankora's behalf who is granted access has signed a personal undertaking of confidentiality and of use of the data for the purpose of the task alone. The undertaking survives the end of their work at Ankora.",
            "When a person's work at Ankora ends, their permissions in Ankora's systems are revoked, and Ankora notifies the authorized contact at the client so that the client can revoke the permissions granted in its own systems.",
          ],
        },
        {
          id: "information-security",
          title: "5. Information security",
          body: [
            "Encryption in transit and at rest, permissions on a need basis, structural separation between clients in the portal, an audit log, rate limiting, and documented periodic security reviews. The full and current detail is in the security and trust page, Document 4.",
          ],
        },
        {
          id: "sub-processors",
          title: "6. Sub-processors",
          body: [
            "The client approves the use of the sub-processors listed in the privacy policy, section 7.",
            "Ankora's engagement with each sub-processor includes information security and confidentiality undertakings no weaker than those in this addendum. Ankora is responsible for the acts of its sub-processors as for its own.",
            "Ankora will give the client thirty days notice before adding a sub-processor that will have access to the client's data. A client that objects on reasonable security or privacy grounds will say so within fourteen days, and the parties will work in good faith to find an alternative. If none is found, the client may terminate the engagement at the end of the following month, and this will not be treated as a breach on the client's part.",
          ],
        },
        {
          id: "ai-and-model-training",
          title: "7. AI and model training",
          body: [
            "Ankora integrates AI systems into the operational layer, as described in the privacy policy, section 6.",
            "**Ankora does not train models on the client's data.** Neither its own models nor those of others. Ankora's engagement with its AI providers prohibits the provider from training models on data that passes through it.",
            "A decision made towards the client or towards a third party is always made by a person. The data passed to the AI systems is limited to what the task requires.",
          ],
        },
        {
          id: "recording-and-documentation",
          title: "8. Recording and documentation",
          body: [
            "Calls and meetings with the Ankora team are recorded and transcribed, and the record serves operational continuity, quality, and input to the AI systems.",
            "The client is responsible for informing its employees and anyone acting on its behalf who takes part in calls with Ankora, and for obtaining any consent required under the law that applies to the client. A client that asks that its calls, or those of its employees, not be recorded will say so, and Ankora will honor the request.",
          ],
        },
        {
          id: "data-subject-rights",
          title: "9. Data subject rights",
          body: [
            "A data subject request that reaches Ankora and concerns the client's data will be passed to the client within three business days and will not be answered by Ankora.",
            "Ankora will assist the client in locating, correcting, exporting or deleting data, to a reasonable extent and at no additional charge, so that the client can meet the response deadline set by the law that applies to it.",
          ],
        },
        {
          id: "security-incident",
          title: "10. Security incident",
          body: [
            "Ankora will notify the client of a serious security incident affecting the client's data within twenty four hours of becoming aware of it, including before a full investigation. The notice will include what is known at that point: what happened, which data is involved, what has been done and what is required of the client.",
            "Reporting to the Israeli Privacy Protection Authority and to data subjects is the client's responsibility as owner of the database, and Ankora will assist with the information in its possession.",
          ],
        },
        {
          id: "reporting-and-oversight",
          title: "11. Reporting and oversight",
          body: [
            "Once a year Ankora will report to the client on its compliance with the undertakings in this addendum, and will complete a control questionnaire provided by the client.",
            "The client may conduct an audit, itself or through an auditor on its behalf who is not a competitor of Ankora, once a year, on seven days notice, during service hours, and without prejudicing the confidentiality of other clients. A further audit in the same year, other than one following a security incident, will be at the client's expense.",
          ],
        },
        {
          id: "location-of-the-data",
          title: "12. Location of the data",
          body: [
            "The data is stored on the servers of the sub-processors in the United States, as detailed in the privacy policy. The client approves the transfer.",
          ],
        },
        {
          id: "term-return-and-deletion",
          title: "13. Term, return and deletion",
          body: [
            "This addendum is in force for as long as the engagement is active and for as long as Ankora holds the client's data.",
            "On termination Ankora revokes the permissions under its control within three business days, and makes a full export of the data available to the client for up to thirty days.",
            "Ankora will delete the data in its possession within sixty days of termination, other than data the law requires it to retain and backups that are erased in the ordinary backup cycle. On completion of the deletion Ankora will give the client a closing report setting out what was deleted, when, and what was retained and why.",
          ],
        },
        {
          id: "liability",
          title: "14. Liability",
          body: [
            "Ankora's liability under this addendum is subject to the liability cap in the Service Terms, section 13, except in matters that the law does not permit to be limited.",
          ],
        },
        {
          id: "relationship-to-the-other-documents",
          title: "15. Relationship to the other documents",
          body: [
            "This addendum applies to the processing of personal data only. Every other matter is governed by the Service Terms and the proposal.",
            "In the event of a conflict on a matter of privacy or information security, this addendum prevails over the Service Terms. On every other matter, the Service Terms prevail.",
          ],
        },
        {
          id: "annex-a-gdpr-supplement",
          title: "Annex A: GDPR supplement",
          body: [
            "Applies only to a client to whom the GDPR applies. The client is the controller and Ankora is the processor within the meaning of Article 28.",
            "The subject matter, duration, nature and purpose of the processing, the types of personal data and the categories of data subjects are as set out in sections 2 and 13 above.",
            "Ankora will assist the client in meeting its obligations under Articles 32 to 36, including security of processing, breach notification and data protection impact assessment, to a reasonable extent and taking account of the information available to it.",
            "Transfers of personal data from the European Union to Israel rely on the European Commission's adequacy decision for Israel, reaffirmed in January 2024 and subject to periodic review. Onward transfer to the sub-processors in the United States relies on those providers' own transfer mechanisms, including standard contractual clauses or certification under the EU and US Data Privacy Framework.",
            "Data transferred to Israel from the European Economic Area is also subject to the Israeli Privacy Protection Regulations on data transferred to Israel from the EEA, and Ankora acts in accordance with them.",
          ],
        },
      ],
    },
  },
};

export default legal;

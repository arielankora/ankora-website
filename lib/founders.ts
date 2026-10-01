/**
 * Ankora's founders: one list for the About page and the structured data
 * (lib/schema.ts), so the name on the page and the name search engines read
 * can never drift apart. Roles are taken from each founder's own LinkedIn
 * profile; nothing here is written that the founders have not said publicly.
 * Photos: public/team/, from the founders' LinkedIn profile photos (1.10.2026).
 */
export type Founder = {
  name: { he: string; en: string };
  role: { he: string; en: string };
  linkedin: string;
  image: string;
};

export const FOUNDERS: Founder[] = [
  {
    name: { he: "אריאל אוטניק", en: "Ariel Utnik" },
    role: { he: "מייסד שותף", en: "Co-Founder" },
    linkedin: "https://www.linkedin.com/in/utnik/",
    image: "/team/ariel-utnik.jpg",
  },
  {
    name: { he: "הדס וינוגורה", en: "Hadas Vinogura" },
    role: { he: "מייסדת שותפה, מנהלת לקוחות ותפעול ראשית", en: "Co-Founder, Chief Client & Operations Officer" },
    linkedin: "https://www.linkedin.com/in/hadas-vinogura-2a96b496/",
    image: "/team/hadas-vinogura.jpg",
  },
];

/** The official company profiles, for Organization.sameAs. */
export const COMPANY_PROFILES = ["https://www.linkedin.com/company/ankora-israel/"];

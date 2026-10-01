/**
 * Ankora's founders: one list for the About page and the structured data
 * (lib/schema.ts), so the name on the page and the name search engines read
 * can never drift apart. Roles and bios are drawn from each founder's own
 * LinkedIn profile and approved by them; nothing here goes beyond what they
 * have said publicly.
 * Photos: public/team/, from the founders' LinkedIn profile photos (1.10.2026).
 */
export type Founder = {
  name: { he: string; en: string };
  role: { he: string; en: string };
  /** Three or four sentences, drawn from the founder's own LinkedIn profile. */
  bio: { he: string; en: string };
  linkedin: string;
  image: string;
};

export const FOUNDERS: Founder[] = [
  {
    name: { he: "אריאל אוטניק", en: "Ariel Utnik" },
    role: { he: "מייסד שותף ומנכ״ל", en: "Co-Founder & CEO" },
    bio: {
      he: "למעלה מ-25 שנה בהובלת חברות טכנולוגיה, בישראל ובארה\"ב. ייסד את Seemore ואת Aggua וכיהן כמנכ\"ל של שתיהן, והיה Chief Revenue Officer ו-GM ב-Verbit.ai ו-Chief Customer Officer ב-Feedvisor. מאז 2016 הוא מייעץ למייסדים ולמנכ\"לים של חברות B2B בתחומי אסטרטגיה, go-to-market וצמיחה ארגונית. באנקורה הוא מוביל את החברה ואת בניית המודל של אדם ו-AI.",
      en: "Over 25 years leading technology companies in Israel and the US. Ariel founded Seemore and Aggua and served as CEO of both, and was Chief Revenue Officer and GM at Verbit.ai and Chief Customer Officer at Feedvisor. Since 2016 he has advised founders and CEOs of B2B companies on strategy, go-to-market and organisational scale. At Ankora he leads the company and the Human + AI model behind it.",
    },
    linkedin: "https://www.linkedin.com/in/utnik/",
    image: "/team/ariel-utnik.jpg",
  },
  {
    name: { he: "הדס וינוגורה", en: "Hadas Vinogura" },
    role: { he: "מייסדת שותפה, מנהלת לקוחות ותפעול ראשית", en: "Co-Founder, Chief Client & Operations Officer" },
    bio: {
      he: "מובילה את הביצוע התפעולי של אנקורה: הופכת צרכים של לקוחות לביצוע מסודר, ומנהלת את האנשים, הספקים והתהליכים שנדרשים כדי שהעבודה תיעשה. מאז 2017 היא מנהלת תפעול מורכב עם הרבה גורמים מעורבים: כמנהלת תפעול אזורית בעמותת רקפת ובאשכולות חשיבה, מול רשויות, בתי ספר וספקים, וכיו\"ר קליטה ותפעול מגורים בקהילה קיבוצית. באנקורה היא אחראית שכל משימה תגיע לסיום.",
      en: "Hadas leads Ankora's operational delivery, turning client needs into structured execution and managing the people, suppliers and processes it takes. Since 2017 she has run complex multi-stakeholder operations: as Regional Operations Director at Rakefet and Eshkolot Hashiva, working with municipalities, schools and service providers, and as chair of community integration and residential operations in a kibbutz community. At Ankora, she owns every task through to completion.",
    },
    linkedin: "https://www.linkedin.com/in/hadas-vinogura-2a96b496/",
    image: "/team/hadas-vinogura.jpg",
  },
];

/** The official company profiles, for Organization.sameAs. */
export const COMPANY_PROFILES = ["https://www.linkedin.com/company/ankora-israel/"];

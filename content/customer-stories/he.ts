import type { CustomerStory } from "./types";

/**
 * Hebrew customer stories, newest first.
 *
 * Publishing rule, and it is not negotiable: every sentence here has to be something the
 * customer said, wrote, or approved. No composed quotes, no inferred numbers, no
 * outcomes we did not observe. A section with no evidence behind it is left out, not
 * filled in.
 */
const stories: CustomerStory[] = [
  {
    slug: "gilad-komorov",
    locale: "he",
    customerName: "גלעד קומורוב",
    customerRole: "3X CRO | Revenue Architect | GTM Advisor",
    customerType: "executive",
    headline: "להעביר אחריות, לא רק משימות",
    summary:
      "איך גלעד הוריד מעצמו משימות שוטפות ופינה זמן לעבודה שבה הוא מייצר את הערך הגבוה ביותר.",
    sections: [
      {
        kind: "context",
        body: [
          "גלעד קומורוב מלווה חברות בבניית מנוע ההכנסות שלהן. זהו תפקיד שבו הערך שלו נמדד בעבודה אסטרטגית מול הנהלות וצוותי מכירות, לא בניהול השוטף שסביבה.",
        ],
      },
      {
        kind: "problem",
        body: [
          "כמו אצל מנהלים בכירים רבים, העומס לא הגיע ממשימה אחת גדולה אלא מהצטברות של קצוות קטנים: תיאומים, ספקים, מנהלה ומעקב, שכל אחד מהם קצר מכדי להצדיק האצלה, וביחד צורך שעות וקשב.",
        ],
      },
      {
        kind: "why-alternatives-fell-short",
        body: [
          "גיוס עוזר אישי במשרה מלאה לא נדרש בהיקף הזה, ופיצול המשימות בין כמה נותני שירות רק החזיר את הניהול אליו: מישהו עדיין היה צריך להחזיק את התמונה המלאה, להזכיר ולסגור.",
        ],
      },
      {
        kind: "ankora-approach",
        body: [
          "במקום להעביר משימות בודדות, גלעד העביר אחריות. מנהל תפעול ייעודי מ־Ankora מחזיק את התחומים שסוכמו מקצה לקצה, כולל ההחלטות הקטנות והמעקב שביניהן, ופונה אליו רק כשנדרשת הכרעה שלו.",
        ],
      },
      {
        kind: "how-the-work-is-managed",
        body: [
          "העבודה מתנהלת מול איש צוות קבוע, לא מול מוקד מתחלף, ונתמכת בטכנולוגיה ובכלי AI שמשמשים את מנהל התפעול למעקב, תיעדוף ותיאום. ההחלטות והאחריות נשארות אצל אדם.",
        ],
      },
      {
        kind: "outcome",
        body: [
          "העומס התפעולי השוטף ירד, ומספר הקצוות הפתוחים שדרשו את תשומת ליבו של גלעד קטן, מה שפינה זמן לעבודה שבה הוא מייצר את הערך הגבוה ביותר.",
        ],
      },
    ],
    areasManaged: ["coordination", "vendors", "administration", "follow-up"],
    outcomes: ["reduced-operational-load", "fewer-open-loops", "end-to-end-ownership", "time-saved"],
    independentEvidence: {
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7507368372758536192/",
      label: "הפוסט של גלעד קומורוב ב־LinkedIn",
      type: "LinkedIn",
    },
    image: {
      src: "/customer-stories/gilad-komorov.png",
      alt: "גלעד קומורוב",
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

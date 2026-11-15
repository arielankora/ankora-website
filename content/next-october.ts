import type { Locale } from "@/content";

/**
 * In memory of Sgt. Nathanel Young (2003-2023): the page Ankora carries for him as part
 * of the Next October initiative. It moved here from Seemore Data's site
 * (seemoredata.io/seemore-next-october), together with Ankora taking on the commitment.
 *
 * The English story is the original page's text, unchanged. The Hebrew story is the
 * family-facing Hebrew text from the Next October sticker Seemore Data prepared. Both
 * are memorial text: they are not edited for marketing tone, and a change goes past
 * Ariel first.
 */

export type MemorialTrack = { title: string; artist: string; href: string };

export type NextOctoberContent = {
  meta: { title: string; description: string };
  eyebrow: string;
  rank: string;
  name: string;
  years: string;
  heroAlt: string;
  portraitAlt: string;
  videoLabel: string;
  lead: string;
  quote: string;
  storyTitle: string;
  story: string[];
  musicTitle: string;
  musicAvatarAlt: string;
  musicListenLabel: string;
  tracks: MemorialTrack[];
  rememberTitle: string;
  remember: string[];
  nextOctoberLinkLabel: string;
  nextOctoberLogoAlt: string;
  hashtags: string[];
};

const SOUNDCLOUD = "https://soundcloud.com/young-nat-774361396";

// Track titles are the artist's own and stay in Latin in both locales.
const tracks: MemorialTrack[] = [
  { title: "Doja X Packs & Potions", artist: "DJ ENY", href: `${SOUNDCLOUD}/doja-x-packs-potions` },
  { title: "DJ ENY: The London Mix (Volume 2)", artist: "DJ ENY", href: `${SOUNDCLOUD}/dj-eny-the-london-mix-volume-2` },
  { title: "Trap Way Volume 3: Side A", artist: "DJ_Fitz1", href: "https://soundcloud.com/dj_fitz/trap-way-volume-3-side-a" },
  { title: "Remixes", artist: "DJ ENY", href: `${SOUNDCLOUD}/sets/remixes` },
  { title: "DJ ENY: The London Mix", artist: "DJ ENY", href: `${SOUNDCLOUD}/dj-eny-the-london-mix` },
  { title: "Heart Monitor Riddim (Kurupt FM) Bassline Remix", artist: "DJ ENY", href: `${SOUNDCLOUD}/heart-monitor-riddim-kurupt-fm-dnb-remix` },
  { title: "Lock Doh (Giggs) DnB Remix", artist: "DJ ENY", href: `${SOUNDCLOUD}/lock-doh-giggs-dnb-remix` },
];

const hashtags = ["#NextOctober", "#NeverForget", "#UnityInMemory", "#LegacyOfInnovation"];

export const NEXT_OCTOBER_URL = "https://www.nextoctober.org/";
export const NATHANEL_SOUNDCLOUD = SOUNDCLOUD;

const he: NextOctoberContent = {
  meta: {
    title: "לזכרו של סמל נתנאל יאנג (2003-2023) | Next October | Ankora",
    description:
      "אנקורה מנציחה את סמל נתנאל יאנג, לוחם גדוד 13 של גולני שנפל ב-7 באוקטובר 2023 ליד קיבוץ זיקים, במסגרת יוזמת Next October.",
  },
  eyebrow: "לזכרו של",
  rank: "סמל",
  name: "נתנאל יאנג",
  years: "2003-2023",
  heroAlt: "סמל נתנאל יאנג במדים",
  portraitAlt: "נתנאל יאנג במדים",
  videoLabel: "סרטון של נתנאל עם חבריו לשירות",
  lead: "נתנאל חי את החיים במלואם. החזון שלו הוא המורשת שלנו.",
  quote: "Some people want it to happen, some wish it would happen, others make it happen.",
  storyTitle: "לוחם צעיר ואמיץ, מוזיקאי נלהב, גיבור.",
  story: [
    "נתנאל נולד למשפחה יהודית בצפון לונדון, וגילה מגיל צעיר אהבה למוזיקה ולאופנה.",
    "באפריל 2023 נתנאל הלך בעקבות אחיו ועלה לישראל, וכאן התגייס לגדוד 13 של גולני.",
    "ב-7 באוקטובר 2023, בעת ששירת סמוך לקיבוץ זיקים, חש עם חבריו לעזרת חיילת שהותקפה בידי מחבלי חמאס.",
    "נתנאל נפל בקרב, אך גבורתו הצילה חיים רבים וממשיכה לנסוך השראה בכל מי שהכיר אותו.",
  ],
  musicTitle: "המוזיקה של נתנאל ממשיכה לחיות",
  musicAvatarAlt: "DJ ENY, השם של נתנאל כתקליטן",
  musicListenLabel: "להאזנה ב-SoundCloud",
  tracks,
  rememberTitle: "באהבה ובכבוד, אנחנו מתחייבים לזכור",
  remember: [
    "אנקורה גאה לעמוד לצד קהילת הסטארטאפים הישראלית ויוזמת Next October, שמנציחה את חללי מלחמת אוקטובר 2023 דרך חדשנות.",
    "ביוזמה קמים יותר מ-1,400 סטארטאפים, וכל אחד מהם מוקדש לזכרו של חייל או אזרח שנפל. כך הסיפורים שלהם הופכים לתרומה מתמשכת שבונה עתיד טוב יותר.",
    "אנקורה נושאת את זכרו של נתנאל.",
  ],
  nextOctoberLinkLabel: "לאתר יוזמת Next October",
  nextOctoberLogoAlt: "Next October",
  hashtags,
};

const en: NextOctoberContent = {
  meta: {
    title: "In Loving Memory of Sgt. Nathanel Young (2003-2023) | Next October | Ankora",
    description:
      "Ankora honors Sgt. Nathanel Young, a Golani Brigade soldier who fell on October 7, 2023 near Kibbutz Zikim, as part of the Next October initiative.",
  },
  eyebrow: "In loving memory of",
  rank: "Sgt.",
  name: "Nathanel Young",
  years: "2003-2023",
  heroAlt: "Sgt. Nathanel Young in uniform",
  portraitAlt: "Nathanel Young in uniform",
  videoLabel: "Video of Nathanel with his fellow soldiers",
  lead: "Nathanel lived life to the fullest. His vision is our legacy.",
  quote: "Some people want it to happen, some wish it would happen, others make it happen.",
  storyTitle: "A brave young soldier, a passionate musician, a hero.",
  story: [
    "Nathanel grew up in a Jewish family in North London, discovering a deep love of music and fashion from an early age. Despite his many interests, his dream of living in Israel and joining the IDF stood out.",
    "Inspired by his siblings who had made Aliyah and served in the IDF, he finally made Aliyah in April 2023. He joined the Golani Brigade Unit 13, excelling in his training and earning the respect of his peers.",
    "On October 7, 2023, Nathanel was stationed at Yiftach base near Kibbutz Zikim. When a fellow soldier was in danger, he and his comrades rushed to her aid, facing an ambush by Hamas terrorists.",
    "Nathanel was killed in the ensuing battle, but his bravery saved many lives. Nathanel’s legacy of bravery continues to inspire and impact those who knew him.",
  ],
  musicTitle: "Nathanel’s music lives on",
  musicAvatarAlt: "DJ ENY, Nathanel’s DJ name",
  musicListenLabel: "Listen on SoundCloud",
  tracks,
  rememberTitle: "With love and honor, we commit to remember",
  remember: [
    "Ankora is proud to stand with Israel’s startup community and the Next October initiative, a project aimed at honoring the victims of the October 2023 Hamas War through innovation.",
    "By helping to launch over 1,400 new startups, each dedicated to the memory of a fallen soldier or civilian, we join forces to transform these stories into lasting contributions that shape a better future.",
    "Ankora carries Nathanel’s memory.",
  ],
  nextOctoberLinkLabel: "Visit the Next October initiative",
  nextOctoberLogoAlt: "Next October",
  hashtags,
};

export function getNextOctoberContent(locale: Locale): NextOctoberContent {
  return locale === "en" ? en : he;
}

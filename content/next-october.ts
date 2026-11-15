import type { Locale } from "@/content";

/**
 * In memory of Sgt. Nathanel Young (2003-2023): the page Ankora carries for him as part
 * of the Next October initiative. It moved here from Seemore Data's site
 * (seemoredata.io/seemore-next-october), together with Ankora taking on the commitment,
 * and keeps that page's layout, images, video and SoundCloud players.
 *
 * The English text is the original page's text. The Hebrew story is the Hebrew text from
 * the Next October sticker Seemore Data prepared. The commitment paragraph is written in
 * Ankora's name (approved by Ariel, 14.11.2026). This is memorial text: it is not edited
 * for marketing tone, and a change goes past Ariel first.
 */

export type MemorialTrack = {
  /** SoundCloud API resource, e.g. "tracks/1319683036" or "playlists/1030441960". */
  resource: string;
  /** Player height, as on the original page: 166 for a track, 450 for a playlist. */
  height: number;
  title: string;
  artist: string;
  artistHref: string;
  href: string;
};

export type NextOctoberContent = {
  meta: { title: string; description: string };
  caption: string;
  name: string;
  years: string;
  heroAlt: string;
  phraseCaption: string;
  quote: string;
  quoteAlt: string;
  storyTitleLines: [string, string];
  story: string[];
  videoLabel: string;
  musicTitle: string;
  musicAvatarAlt: string;
  rememberTitle: string;
  remember: string[];
  ankoraLogoAlt: string;
  nextOctoberLogoAlt: string;
};

const NAT = "https://soundcloud.com/young-nat-774361396";

// Exactly the seven players on the original page, in its order.
export const MEMORIAL_TRACKS: MemorialTrack[] = [
  { resource: "tracks/1319683036", height: 166, artist: "DJ ENY", artistHref: NAT, title: "Doja X Packs & Potions", href: `${NAT}/doja-x-packs-potions` },
  { resource: "tracks/935981608", height: 166, artist: "DJ ENY", artistHref: NAT, title: "DJ ENY: THE LONDON MIX (VOLUME 2)", href: `${NAT}/dj-eny-the-london-mix-volume-2` },
  { resource: "tracks/931664272", height: 166, artist: "DJ_Fitz1", artistHref: "https://soundcloud.com/dj_fitz", title: "Trap Way Volume 3: Side A", href: "https://soundcloud.com/dj_fitz/trap-way-volume-3-side-a" },
  { resource: "playlists/1030441960", height: 450, artist: "DJ ENY", artistHref: NAT, title: "Remixes", href: `${NAT}/sets/remixes` },
  { resource: "tracks/716523397", height: 166, artist: "DJ ENY", artistHref: NAT, title: "DJ ENY: THE LONDON MIX", href: `${NAT}/dj-eny-the-london-mix` },
  { resource: "tracks/588931953", height: 166, artist: "DJ ENY", artistHref: NAT, title: "Heart Monitor Riddim (Kurupt FM) Bassline Remix", href: `${NAT}/heart-monitor-riddim-kurupt-fm-dnb-remix` },
  { resource: "tracks/528180078", height: 166, artist: "DJ ENY", artistHref: NAT, title: "Lock Doh (Giggs) DnB Remix", href: `${NAT}/lock-doh-giggs-dnb-remix` },
];

/** The SoundCloud player URL, with the original page's parameters. */
export function soundcloudPlayerUrl(resource: string): string {
  return (
    "https://w.soundcloud.com/player/?url=" +
    encodeURIComponent(`https://api.soundcloud.com/${resource}`).replace(/%2F/g, "/") +
    "&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true"
  );
}

export const NEXT_OCTOBER_URL = "https://www.nextoctober.org/";

export const MEMORIAL_HASHTAGS = [
  { tag: "#NextOctober", href: "https://x.com/search?q=%23NextOctober&src=typed_query" },
  { tag: "#NeverForget", href: "https://x.com/search?q=%23NeverForget%20&src=typed_query&f=top" },
  { tag: "#UnityInMemory", href: "https://x.com/search?q=%23UnityInMemory&src=typed_query&f=top" },
  { tag: "#LegacyOfInnovation", href: "https://x.com/search?q=%23LegacyOfInnovation&src=typed_query&f=top" },
];

const he: NextOctoberContent = {
  meta: {
    title: "לזכרו של סמל נתנאל יאנג (2003-2023) | Next October | Ankora",
    description:
      "אנקורה מנציחה את סמל נתנאל יאנג, לוחם גדוד 13 של גולני שנפל ב-7 באוקטובר 2023 ליד קיבוץ זיקים, במסגרת יוזמת Next October.",
  },
  caption: "לזכרו של",
  name: "סמל נתנאל יאנג",
  years: "(2003-2023)",
  heroAlt: "סמל נתנאל יאנג במדים",
  phraseCaption: "נתנאל חי את החיים במלואם. החזון שלו הוא המורשת שלנו",
  quote: "\"Some people want it to happen, some wish it would happen, others make it happen.\"",
  quoteAlt: "נתנאל יאנג במדים",
  storyTitleLines: ["לוחם צעיר ואמיץ,", "מוזיקאי נלהב, גיבור."],
  story: [
    "נתנאל נולד למשפחה יהודית בצפון לונדון, וגילה מגיל צעיר אהבה למוזיקה ולאופנה.",
    "באפריל 2023 נתנאל הלך בעקבות אחיו ועלה לישראל, וכאן התגייס לגדוד 13 של גולני.",
    "ב-7 באוקטובר 2023, בעת ששירת סמוך לקיבוץ זיקים, חש עם חבריו לעזרת חיילת שהותקפה בידי מחבלי חמאס.",
    "נתנאל נפל בקרב, אך גבורתו הצילה חיים רבים וממשיכה לנסוך השראה בכל מי שהכיר אותו.",
  ],
  videoLabel: "סרטון של נתנאל עם חבריו לשירות",
  musicTitle: "המוזיקה של נתנאל ממשיכה לחיות",
  musicAvatarAlt: "DJ ENY, השם של נתנאל כתקליטן",
  rememberTitle: "באהבה ובכבוד, אנחנו מתחייבים לזכור",
  remember: [
    "אנקורה גאה לעמוד לצד קהילת הסטארטאפים הישראלית ויוזמת Next October, שמנציחה את חללי מלחמת אוקטובר 2023 דרך חדשנות. ביוזמה קמים יותר מ-1,400 סטארטאפים, וכל אחד מהם מוקדש לזכרו של חייל או אזרח שנפל. כך הסיפורים שלהם הופכים לתרומה מתמשכת שבונה עתיד טוב יותר.",
    "אנקורה נושאת את זכרו של נתנאל.",
  ],
  ankoraLogoAlt: "Ankora",
  nextOctoberLogoAlt: "Next October",
};

const en: NextOctoberContent = {
  meta: {
    title: "In Loving Memory of Sgt. Nathanel Young (2003-2023) | Next October | Ankora",
    description:
      "Ankora honors Sgt. Nathanel Young, a Golani Brigade soldier who fell on October 7, 2023 near Kibbutz Zikim, as part of the Next October initiative.",
  },
  caption: "In loving memory of",
  name: "Sgt. Nathanel Young",
  years: "(2003-2023)",
  heroAlt: "Sgt. Nathanel Young in uniform",
  phraseCaption: "Nathanel lived life to the fullest. His vision is our legacy",
  quote: "\"Some people want it to happen, some wish it would happen, others make it happen.\"",
  quoteAlt: "Nathanel Young in uniform",
  storyTitleLines: ["A brave young soldier,", "A passionate musician, A hero."],
  story: [
    "Nathanel grew up in a Jewish family in North London, discovering a deep love of music and fashion from an early age. Despite his many interests, his dream of living in Israel and joining the IDF stood out.",
    "Inspired by his siblings who had made Aliyah served in the IDF, he finally made Aliya in April 2023. He joined the Golani Brigade Unit 13, excelling in his training and earning the respect of his peers.",
    "On October 7, 2023, Nathanel was stationed at Yiftach base near Kibbutz Zikim. When a fellow soldier was in danger, he and his comrades rushed to her aid, facing an ambush by Hamas terrorists.",
    "Nathanel was killed in the ensuing battle, but his bravery saved many lives. Nathanel’s legacy of bravery continues to inspire and impact those who knew him.",
  ],
  videoLabel: "Video of Nathanel with his fellow soldiers",
  musicTitle: "Nathanel’s music lives on",
  musicAvatarAlt: "DJ ENY, Nathanel’s DJ name",
  rememberTitle: "With love and honor, we commit to remember",
  remember: [
    "Ankora is proud to stand with Israel’s startup community and the Next October initiative, a project aimed at honoring the victims of the October 2023 Hamas War through innovation. By helping to launch over 1,400 new startups, each dedicated to the memory of a fallen soldier or civilian, we join forces to transform these stories into lasting contributions that shape a better future.",
    "Ankora carries Nathanel’s memory.",
  ],
  ankoraLogoAlt: "Ankora",
  nextOctoberLogoAlt: "Next October",
};

export function getNextOctoberContent(locale: Locale): NextOctoberContent {
  return locale === "en" ? en : he;
}

/* eslint-disable @next/next/no-img-element -- <picture> with art-directed sources, as on the original page */
import localFont from "next/font/local";
import type { Locale } from "@/content";
import {
  getNextOctoberContent,
  MEMORIAL_HASHTAGS,
  MEMORIAL_TRACKS,
  NEXT_OCTOBER_URL,
  soundcloudPlayerUrl,
} from "@/content/next-october";
import s from "./memorial.module.css";

/**
 * In memory of Sgt. Nathanel Young, carried by Ankora within the Next October initiative.
 *
 * A copy of the page Seemore Data published (seemoredata.io/seemore-next-october): same
 * sections, images, video, SoundCloud players and styles (memorial.module.css). Two things
 * differ on purpose: Ankora's logo stands where Seemore Data's did, and the page sits
 * between Ankora's own header and footer. The SoundCloud players need w.soundcloud.com in
 * the marketing CSP's frame-src (next.config.mjs).
 */

// Poppins, the original page's typeface, self-hosted (font-src 'self'). Latin only:
// Hebrew text falls through to Heebo, the site's Hebrew face.
const poppins = localFont({
  src: [
    { path: "./fonts/poppins-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "./fonts/poppins-latin-300-italic.woff2", weight: "300", style: "italic" },
    { path: "./fonts/poppins-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/poppins-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/poppins-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/poppins-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-poppins",
  display: "swap",
});

const MOBILE = "(max-width: 990.98px)";

export function NextOctoberMemorialPage({ locale }: { locale: Locale }) {
  const c = getNextOctoberContent(locale);
  const textDir = locale === "he" ? "rtl" : "ltr";
  const external = { target: "_blank", rel: "noopener noreferrer" } as const;

  return (
    // The layout is left-to-right in both locales, like the original; text blocks carry
    // their own direction.
    <div dir="ltr" className={`${poppins.variable} ${s.root}`}>
      <section>
        <div className={s["first-screen-next__inner"]}>
          <picture className={s["first-screen-next__background"]}>
            <source media={MOBILE} srcSet="/next-october/hero-mobile.webp" />
            <img src="/next-october/hero.webp" alt={c.heroAlt} width={1440} height={912} fetchPriority="high" />
          </picture>
          <div className={s["first-screen-next__wrapper"]}>
            <div
              className={`${s["first-screen-next__content"]} ${locale === "he" ? s["first-screen-next__content--rtl"] : ""}`}
              dir={textDir}
            >
              <div className={s["first-screen-next__content-caption"]}>{c.caption}</div>
              <h1 className={s["first-screen-next__content-title"]}>{c.name}</h1>
              <div className={s["first-screen-next__content-text"]}>
                <span dir="ltr">{c.years}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={s["person-phrase"]}>
        <div className={s["person-phrase__wrapper"]}>
          <picture className={s["person-phrase__image"]}>
            <source media={MOBILE} srcSet="/next-october/quote-mobile.webp" />
            <img src="/next-october/quote.webp" alt={c.quoteAlt} width={570} height={580} loading="lazy" />
          </picture>
          <div className={s["person-phrase__content"]}>
            <div className={s["person-phrase__content-caption"]} dir={textDir}>
              {c.phraseCaption}
            </div>
            <div className={s["person-phrase__content-text"]} lang="en">
              {c.quote}
            </div>
          </div>
        </div>
      </section>

      <section className={s["about-person"]}>
        <div className={s["about-person__inner"]}>
          <h2 className={s["about-person__title"]} dir={textDir}>
            {c.storyTitleLines[0]}
            <br />
            {c.storyTitleLines[1]}
          </h2>
          <div className={s["about-person__wrapper"]}>
            <div className={s["about-person__text"]} dir={textDir}>
              <div className={s.text}>
                {c.story.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            </div>
            <div className={s["about-person__media"]}>
              {/* As on the original: plays muted, on a loop, without controls. */}
              <video
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster="/next-october/video-poster.webp"
                aria-label={c.videoLabel}
              >
                <source src="/next-october/nathanel.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </div>
      </section>

      <section className={s["section-music"]}>
        <div className={s["section-music__image"]}>
          <img src="/next-october/avatar.webp" alt={c.musicAvatarAlt} width={120} height={120} loading="lazy" />
        </div>
        <div className={s["section-music__inner"]}>
          <div className={s["section-music__title"]} dir={textDir}>
            {c.musicTitle}
          </div>
          <div className={s["section-music__list"]}>
            <div className={s.list}>
              {MEMORIAL_TRACKS.map((t) => (
                <div className={s.item} key={t.resource}>
                  <iframe
                    title={`${t.artist} · ${t.title}`}
                    loading="lazy"
                    width="100%"
                    height={t.height}
                    allow="autoplay"
                    src={soundcloudPlayerUrl(t.resource)}
                  />
                  <div className={s.credit}>
                    <a href={t.artistHref} title={t.artist} {...external}>
                      {t.artist}
                    </a>
                    {" · "}
                    <a href={t.href} title={t.title} {...external}>
                      {t.title}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={s["section-respect"]}>
        <div className={s["section-respect__inner"]}>
          <picture className={s["section-respect__image"]}>
            <source media={MOBILE} srcSet="/next-october/remember-mobile.webp" />
            <img src="/next-october/remember.webp" alt="" width={1440} height={630} loading="lazy" />
          </picture>
          <div className={s["section-respect__content"]} dir={textDir}>
            <h2 className={s["section-respect__content-title"]}>{c.rememberTitle}</h2>
            <div className={s["section-respect__content-text"]}>
              <div className={s.text}>
                {c.remember.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={s["section-footer-next"]}>
        <div className={s["section-footer-next__inner"]}>
          <div className={s["section-footer-next__partners"]}>
            <div className={s.list}>
              <a className={s.item} href={`/${locale}`}>
                <img src="/next-october/ankora-card.webp" alt={c.ankoraLogoAlt} width={372} height={216} loading="lazy" />
              </a>
              <a className={s.item} href={NEXT_OCTOBER_URL} {...external}>
                <img src="/next-october/next-october-card.webp" alt={c.nextOctoberLogoAlt} width={372} height={216} loading="lazy" />
              </a>
            </div>
          </div>
          <div className={s["section-footer-next__hashtags"]}>
            <div className={s.list}>
              {MEMORIAL_HASHTAGS.map((h) => (
                <a className={s.item} key={h.tag} href={h.href} {...external}>
                  {h.tag}
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

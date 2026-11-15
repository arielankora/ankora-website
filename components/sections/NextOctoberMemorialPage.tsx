import Image from "next/image";
import type { Locale } from "@/content";
import { getNextOctoberContent, NATHANEL_SOUNDCLOUD, NEXT_OCTOBER_URL } from "@/content/next-october";
import { WideContainer } from "@/components/ui/WideContainer";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/motion/Reveal";

/**
 * In memory of Sgt. Nathanel Young, carried by Ankora within the Next October initiative.
 *
 * A memorial, not a marketing page: no CTA, no FAQ, no cross-links to the services. The
 * music links go out to SoundCloud rather than embedding its player, so the site's
 * Content-Security-Policy keeps frame-src to Google Calendar only.
 */
export function NextOctoberMemorialPage({ locale }: { locale: Locale }) {
  const c = getNextOctoberContent(locale);
  const external = { target: "_blank", rel: "noopener noreferrer" } as const;

  return (
    <>
      <section className="relative overflow-hidden pb-14 pt-40 md:pb-20 md:pt-48">
        <WideContainer className="relative z-[1]">
          <div className="grid items-end gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div>
              <Reveal>
                <Eyebrow>{c.eyebrow}</Eyebrow>
              </Reveal>
              <Reveal delay={0.08}>
                <h1 className="mt-6 text-balance text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.1] tracking-[-0.03em] text-cream">
                  <span className="block text-[0.5em] text-body">{c.rank}</span>
                  {c.name}
                </h1>
              </Reveal>
              <Reveal delay={0.14}>
                <p className="mt-4 font-mono text-sm tracking-[0.12em] text-gold">
                  <span dir="ltr">{c.years}</span>
                </p>
              </Reveal>
              <Reveal delay={0.2}>
                <p className="mt-8 max-w-[48ch] font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-body">
                  {c.lead}
                </p>
              </Reveal>
            </div>
            <Reveal delay={0.1}>
              <Image
                src="/next-october/hero.webp"
                alt={c.heroAlt}
                width={1440}
                height={912}
                priority
                sizes="(min-width: 768px) 55vw, 100vw"
                className="h-auto w-full border border-[rgba(243,234,219,0.12)]"
              />
            </Reveal>
          </div>
        </WideContainer>
      </section>

      <SectionShell>
        <div className="grid items-center gap-10 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Reveal>
            <Image
              src="/next-october/quote.webp"
              alt={c.portraitAlt}
              width={570}
              height={580}
              sizes="(min-width: 768px) 35vw, 100vw"
              className="h-auto w-full max-w-[460px] border border-[rgba(243,234,219,0.12)]"
            />
          </Reveal>
          <Reveal delay={0.08}>
            <blockquote
              lang="en"
              dir="ltr"
              className="border-s border-gold ps-6 text-start text-[clamp(1.4rem,2.6vw,2.2rem)] font-extralight leading-[1.4] text-cream"
            >
              “{c.quote}”
            </blockquote>
          </Reveal>
        </div>
      </SectionShell>

      <SectionShell>
        <div className="grid items-start gap-10 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <Reveal>
            <h2 className="max-w-xl text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
              {c.storyTitle}
            </h2>
            <div className="mt-8 max-w-2xl space-y-5 font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-body">
              {c.story.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            {/* Same-origin file, so default-src 'self' already covers it. No autoplay:
                the clip has sound, and a memorial page should not start talking. */}
            <video
              controls
              playsInline
              preload="metadata"
              poster="/next-october/nathanel-poster.webp"
              width={670}
              height={720}
              aria-label={c.videoLabel}
              className="h-auto w-full max-w-[420px] border border-[rgba(243,234,219,0.12)] bg-black"
            >
              <source src="/next-october/nathanel.mp4" type="video/mp4" />
            </video>
          </Reveal>
        </div>
      </SectionShell>

      <SectionShell>
        <div className="grid gap-10 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Reveal>
            <a href={NATHANEL_SOUNDCLOUD} {...external} className="inline-block">
              <Image
                src="/next-october/dj-eny.webp"
                alt={c.musicAvatarAlt}
                width={480}
                height={436}
                sizes="240px"
                className="h-auto w-[240px] border border-[rgba(243,234,219,0.12)]"
              />
            </a>
            <h2 className="mt-8 max-w-xl text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
              {c.musicTitle}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <ul className="divide-y divide-[rgba(243,234,219,0.12)] border-y border-[rgba(243,234,219,0.12)]">
              {c.tracks.map((t) => (
                <li key={t.href}>
                  <a
                    href={t.href}
                    {...external}
                    className="group flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 transition-colors hover:text-gold"
                  >
                    <span dir="ltr" className="font-assistant text-[1.05rem] text-cream group-hover:text-gold">
                      {t.title}
                    </span>
                    <span className="font-assistant text-sm text-body">
                      <span dir="ltr">{t.artist}</span> · {c.musicListenLabel}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </SectionShell>

      <SectionShell>
        <div className="grid gap-10 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Reveal>
            <h2 className="max-w-xl text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
              {c.rememberTitle}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="max-w-2xl space-y-5 font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-body">
              {c.remember.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <a
              href={NEXT_OCTOBER_URL}
              {...external}
              className="mt-10 inline-flex items-center gap-5 text-cream transition-colors hover:text-gold"
            >
              <Image
                src="/next-october/next-october-logo.png"
                alt={c.nextOctoberLogoAlt}
                width={302}
                height={170}
                sizes="150px"
                className="h-auto w-[150px]"
              />
              <span className="font-assistant text-[1.02rem] underline underline-offset-4">
                {c.nextOctoberLinkLabel}
              </span>
            </a>
            <p className="mt-8 flex flex-wrap gap-x-4 gap-y-2 font-mono text-xs tracking-[0.08em] text-body" dir="ltr">
              {c.hashtags.map((h) => (
                <span key={h}>{h}</span>
              ))}
            </p>
          </Reveal>
        </div>
      </SectionShell>
    </>
  );
}

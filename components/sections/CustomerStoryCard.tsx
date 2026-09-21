import Link from "next/link";
import Image from "next/image";
import type { Locale } from "@/content";
import type { CustomerStory } from "@/content/customer-stories/types";
import { storiesUi } from "@/content/customer-stories/ui";
import { withLocale } from "@/lib/nav";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Iso, Ltr } from "@/components/ui/Ltr";

/**
 * One story in the hub list.
 *
 * The same hairline-ruled editorial row the blog index and the /solutions profile
 * lists use, for the same reason: a three-column card grid holding one card announces
 * that the section is empty, where a ruled list of one reads as a list of one. The row
 * is identical at one story and at twenty.
 *
 * The headline is the problem or the shift, never the customer's name - the name and
 * role are the mono key above it, which is what a reader scans to decide "is this
 * someone like me".
 *
 * Link wraps the headline only, so the accessible name is the headline; the row is made
 * clickable with the stretched-link pattern already used on /solutions and /blog.
 */
export function CustomerStoryCard({
  story,
  locale,
  variant = "row",
}: {
  story: CustomerStory;
  locale: Locale;
  variant?: "row" | "compact";
}) {
  const ui = storiesUi(locale);
  const href = withLocale(locale, `/customer-stories/${story.slug}`);
  const arrow = locale === "he" ? "←" : "→";

  if (variant === "compact") {
    return (
      <Link
        href={href}
        className="group flex min-h-[56px] flex-col gap-2 bg-navy px-5 py-[18px] outline outline-1 outline-[rgba(243,234,219,0.11)] transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.04)] sm:flex-row sm:items-center sm:justify-between sm:gap-5"
      >
        <span className="flex flex-col gap-1.5">
          <MonoLabel size={10} tracking="0.12em" className="text-gold">
            <Iso>{story.customerName}</Iso>
          </MonoLabel>
          <span className="text-[1.08rem] font-normal leading-[1.35] text-cream transition-colors group-hover:text-gold">
            {story.headline}
          </span>
        </span>
        <MonoLabel size={10} aria-hidden className="flex-none text-muted transition-colors group-hover:text-gold">
          {arrow}
        </MonoLabel>
      </Link>
    );
  }

  return (
    <article className="group relative grid gap-[clamp(24px,4vw,56px)] border-b border-[rgba(243,234,219,0.12)] py-[clamp(26px,3.4vw,40px)] sm:grid-cols-[minmax(0,1fr)_168px]">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <MonoLabel size={10} tracking="0.12em" className="text-gold">
            <Iso>{story.customerName}</Iso>
          </MonoLabel>
          <MonoLabel size={10} aria-hidden className="text-line">
            ·
          </MonoLabel>
          <MonoLabel size={10} className="text-muted">
            {ui.customerTypes[story.customerType]}
          </MonoLabel>
          {story.customerCompany && (
            <>
              <MonoLabel size={10} aria-hidden className="text-line">
                ·
              </MonoLabel>
              <MonoLabel size={10} className="text-muted">
                <Iso>{story.customerCompany}</Iso>
              </MonoLabel>
            </>
          )}
        </div>

        <h2 className="mt-3 text-[clamp(1.3rem,2vw,1.72rem)] font-light leading-[1.3] text-cream">
          <Link
            href={href}
            className="transition-colors duration-200 after:absolute after:inset-0 after:content-[''] group-hover:text-gold"
          >
            {story.headline}
          </Link>
        </h2>

        {story.customerRole && (
          <p className="mt-2 font-assistant text-[14px] font-light leading-[1.6] text-muted">
            <Ltr>{story.customerRole}</Ltr>
          </p>
        )}

        <p className="mt-3 max-w-[64ch] font-assistant text-[16px] font-light leading-[1.7] text-muted">
          {story.summary}
        </p>

        {story.areasManaged && story.areasManaged.length > 0 && (
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {story.areasManaged.map((area) => (
              <MonoLabel key={area} size={10} className="text-muted">
                {ui.useCases[area]}
              </MonoLabel>
            ))}
          </p>
        )}

        <MonoLabel
          size={10}
          aria-hidden
          className="mt-4 block text-gold transition-colors group-hover:text-gold-light"
        >
          {ui.readStory} {arrow}
        </MonoLabel>
      </div>

      {/* A story without a portrait omits the element and the row becomes
          single-column. An empty frame is worse than no frame. */}
      {story.image && (
        // The one rounded element in the system. "Radius 0 everywhere" is the brand
        // rule (components/ui/Button.tsx), and it holds for every surface; a portrait
        // is not a surface, it is a face, and a face reads as a person in a circle and
        // as a passport photo in a square. Approved as a deliberate exception, scoped
        // to customer portraits only.
        <div className="relative aspect-square w-full overflow-hidden rounded-full outline outline-1 outline-[rgba(243,234,219,0.11)]">
          <Image src={story.image.src} alt={story.image.alt} fill sizes="168px" className="object-cover" />
        </div>
      )}
    </article>
  );
}

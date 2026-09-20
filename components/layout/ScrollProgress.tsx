"use client";

import { useEffect, useRef } from "react";

/**
 * Scroll progress bar. Fixed, 2px, z-60. The fill anchors to the inline start edge,
 * so it grows right-to-left in Hebrew and left-to-right in English on its own.
 *
 * Now rendered in both locales (the site redesign collapses the /he-only page
 * furniture). The gradient has no logical-direction keyword in CSS, so it is
 * declared twice and keyed off `dir`: faint at the start edge, solid at the
 * leading edge, in both directions.
 */
export function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = scrollHeight > 0 ? Math.min(100, Math.max(0, (window.scrollY / scrollHeight) * 100)) : 0;
      if (barRef.current) barRef.current.style.width = `${pct}%`;
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-[60] h-[2px]" aria-hidden="true">
      <div
        ref={barRef}
        className="absolute top-0 h-full bg-[linear-gradient(to_right,rgba(176,141,87,0.2),#B08D57)] rtl:bg-[linear-gradient(to_left,rgba(176,141,87,0.2),#B08D57)]"
        style={{ insetInlineStart: 0, width: "0%" }}
      />
    </div>
  );
}

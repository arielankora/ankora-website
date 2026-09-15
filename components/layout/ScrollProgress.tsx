"use client";

import { useEffect, useRef } from "react";

/**
 * Scroll progress bar, `/he`-only (design_handoff_ankora_redesign/README.md,
 * "Page-level furniture" #2). Fixed, 2px, z-60. The fill anchors to the RTL
 * start edge (`insetInlineStart: 0`) so it grows right-to-left, per the hard
 * constraint that progress bars fill right-to-left in this redesign.
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
        className="absolute top-0 h-full"
        style={{
          insetInlineStart: 0,
          width: "0%",
          background: "linear-gradient(to left, #B08D57, rgba(176,141,87,0.2))",
        }}
      />
    </div>
  );
}

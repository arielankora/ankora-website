"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient background glow, on every page in both locales. The two radial gradients and
 * the 18s drift are exactly the spec's "Ambient background" block; the pointer-follow
 * on top of them is a carry-over from the earlier /he round that the site spec is
 * silent about rather than opposed to, kept deliberately (Ariel's decision, C15).
 *
 * A rAF loop lerps
 * a wrapper's translate toward the pointer at factor 0.045, amplitude ±90px
 * horizontal / ±70px vertical. The 18s drift keyframe animates a *nested* element's
 * transform (Tailwind's `animate-glowDrift`) so the CSS animation and the JS pointer
 * transform don't fight over the same property on the same node. Skipped entirely on
 * touch devices and when the user prefers reduced motion — falls back to the static
 * position.
 */
export function PageGlow() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (reduceMotion || isTouch || !wrapperRef.current) return;

    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      targetRef.current = { x: nx * 90, y: ny * 70 };
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const tick = () => {
      const cur = currentRef.current;
      const target = targetRef.current;
      cur.x += (target.x - cur.x) * 0.045;
      cur.y += (target.y - cur.y) * 0.045;
      if (wrapperRef.current) {
        wrapperRef.current.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div
        ref={wrapperRef}
        className="absolute"
        style={{ top: "-30vh", insetInlineEnd: "-10vw", width: "90vw", height: "110vh" }}
      >
        <div
          className="h-full w-full animate-glowDrift"
          style={{
            background:
              "radial-gradient(45% 45% at 50% 50%, rgba(176,141,87,0.16) 0%, rgba(176,141,87,0.06) 42%, rgba(11,27,51,0) 72%)",
          }}
        />
      </div>
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 15% 90%, rgba(60,96,150,0.18) 0%, rgba(11,27,51,0) 70%)",
        }}
      />
    </div>
  );
}

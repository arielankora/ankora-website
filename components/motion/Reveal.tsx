"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

// Content is rendered VISIBLE on the server. Only what starts below the fold
// is hidden after mount and revealed on scroll.
//
// The previous version rendered `initial={{ opacity: 0 }}` on the server and
// waited for `whileInView` after hydration. Everything above the fold (the
// hero headline, the lead paragraph, every page's h1) stayed transparent until
// the JS bundle ran: Lighthouse measured LCP at 4.5-6.9s on mobile with a load
// time of 0 and a render delay of 5.4-6.2s (SEO/GEO audit, 1.10.2026). Crawlers
// and readers without JS saw the same blank space.
//
// Hiding happens in a layout effect, before the first paint after hydration,
// and only for elements whose top is below the viewport, so nobody sees a
// visible element disappear.

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useRevealState(margin: string) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [deferred, setDeferred] = useState(false);
  const inView = useInView(ref, { once: true, margin: margin as `${number}px` });

  useIsoLayoutEffect(() => {
    if (reduceMotion || !ref.current) return;
    if (ref.current.getBoundingClientRect().top > window.innerHeight) setDeferred(true);
    // Measured once, on mount: an element that started on screen never hides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, reduceMotion, hidden: deferred && !inView };
}

export function Reveal({
  children,
  delay = 0,
  y = 16,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const { ref, reduceMotion, hidden } = useRevealState("-80px");

  return (
    <motion.div
      ref={ref}
      initial={false}
      animate={hidden ? { opacity: 0, y } : { opacity: 1, y: 0 }}
      transition={
        reduceMotion || hidden ? { duration: 0 } : { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }
      }
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function RevealStagger({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { ref, reduceMotion, hidden } = useRevealState("-80px");

  return (
    <motion.div
      ref={ref}
      initial={false}
      animate={hidden ? "hidden" : "show"}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: reduceMotion ? 0 : 0.08 } },
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

export const staggerItem = {
  hidden: { opacity: 0, y: 16, transition: { duration: 0 } },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

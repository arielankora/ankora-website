"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { BackLink } from "./BackLink";

// The way back sits in the top bar (19.10.2026, canvas "Ankora App UI
// Round"), before the screen's title, and says where it leads: "משימות ·
// שלי · <client> · "<search>"". The screen knows the target and the
// words; the bar is drawn by the shell. A small context joins them.
//
// The top bar is desktop only, so the same link also renders in the page
// on a phone, and on a desktop until this has run. Both are plain
// anchors (BackLink.tsx).
type Back = { href: string; label: string; testId?: string } | null;

const BackContext = createContext<{ back: Back; setBack: (b: Back) => void }>({ back: null, setBack: () => {} });

export function BackSlotProvider({ children }: { children: ReactNode }) {
  const [back, setBack] = useState<Back>(null);
  return <BackContext.Provider value={{ back, setBack }}>{children}</BackContext.Provider>;
}

/// In the top bar: the back link the current screen registered, if any.
export function TopBarBack() {
  const { back } = useContext(BackContext);
  if (!back) return null;
  return <BackLink href={back.href} label={back.label} testId={back.testId} />;
}

/// On a detail screen: registers its way back with the top bar, and shows
/// it in the page where there is no top bar (a phone) or not yet (before
/// hydration).
export function PageBack({ href, label, testId }: { href: string; label: string; testId?: string }) {
  const { setBack } = useContext(BackContext);
  const [registered, setRegistered] = useState(false);
  useEffect(() => {
    setBack({ href, label, testId });
    setRegistered(true);
    return () => setBack(null);
  }, [href, label, testId, setBack]);
  return (
    <div className={registered ? "md:hidden" : undefined}>
      <BackLink href={href} label={label} testId={testId ? `${testId}-inline` : undefined} />
    </div>
  );
}

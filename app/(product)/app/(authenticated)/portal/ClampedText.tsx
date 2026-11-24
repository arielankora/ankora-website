"use client";

import { useLayoutEffect, useRef, useState } from "react";

// 24.11.2026 (Hadas): a long summary under a task shows two lines and
// "עוד". The button appears only when the text is actually cut.
export function ClampedText({ text, moreLabel, lessLabel }: { text: string; moreLabel: string; lessLabel: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setCut(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);

  return (
    <span className="mt-1 block text-[12.5px] leading-relaxed text-app-text-secondary">
      <span ref={ref} dir="auto" className={`whitespace-pre-line ${open ? "block" : "line-clamp-2"}`}>
        {text}
      </span>
      {(cut || open) && (
        <button type="button" onClick={() => setOpen(!open)} className="tap-area mt-0.5 text-[12px] text-app-text-accent hover:underline">
          {open ? lessLabel : moreLabel}
        </button>
      )}
    </span>
  );
}

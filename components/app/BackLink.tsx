import { ArrowRight } from "lucide-react";

// One way back on every detail screen (19.10.2026). The style is the
// task screen's, which was the only one designed as a control rather
// than a caption. The arrow points right because right is back in
// Hebrew. A plain anchor, never next/link: a document navigation cannot
// be quietly cancelled (claude/search-navigation-lost-2026-09-25.md).
// `href` comes from lib/list-back.ts so the list's filters come back too.
// 19.10.2026: rendered through BackSlot.tsx, in the top bar on a desktop.
// The label names the list and its filters, so it may run long: it
// truncates rather than wrap.
export function BackLink({ href, label, testId }: { href: string; label: string; testId?: string }) {
  return (
    <a
      href={href}
      data-testid={testId}
      title={label}
      aria-label={`חזרה: ${label}`}
      className="inline-flex max-w-[28rem] items-center gap-1.5 rounded-full border border-app-border-strong bg-white px-3 py-1.5 text-[13px] font-medium text-app-text-primary transition-colors hover:border-app-text-primary"
    >
      <ArrowRight size={14} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );
}

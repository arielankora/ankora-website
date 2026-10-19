import { ArrowRight } from "lucide-react";

// One way back on every detail screen (19.10.2026). The style is the
// task screen's, which was the only one designed as a control rather
// than a caption. The arrow points right because right is back in
// Hebrew. A plain anchor, never next/link: a document navigation cannot
// be quietly cancelled (claude/search-navigation-lost-2026-09-25.md).
// `href` comes from lib/list-back.ts so the list's filters come back too.
export function BackLink({ href, label, testId }: { href: string; label: string; testId?: string }) {
  return (
    <a
      href={href}
      data-testid={testId}
      className="inline-flex items-center gap-1.5 rounded-full border border-lineDark bg-white px-3 py-1.5 text-[13px] font-medium text-appNavy/70 transition-colors hover:border-appNavy/30 hover:text-appNavy"
    >
      <ArrowRight size={14} />
      {label}
    </a>
  );
}

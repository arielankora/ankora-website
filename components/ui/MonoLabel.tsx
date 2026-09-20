import { cn } from "@/lib/utils";

/**
 * Mono meta label: breadcrumbs, statuses, numbering, the Latin keys above capability
 * and pillar titles.
 *
 * The `script` prop is what keeps the spec's Hebrew typography rule honest. Tracking is
 * a property of the string, not of the page: a Latin key such as BUSINESS OPS keeps its
 * tracking inside an RTL page, while a Hebrew label drops it entirely, because positive
 * tracking breaks the reading rhythm of a script whose letters are read as connected
 * shapes. Callers pass "latin" for strings that are Latin in both dictionaries and
 * "content" for strings that follow the page language — the latter resolves through the
 * `rtl:` variant, so it is correct in both locales without a locale prop.
 *
 * Tracking is an enum rather than a free string for two reasons: Tailwind's scanner
 * cannot see an interpolated class name, and an inline `style` would beat the `rtl:`
 * override and silently reintroduce tracking on Hebrew.
 */
const TRACKING = {
  "0.1em": "tracking-[0.1em]",
  "0.12em": "tracking-[0.12em]",
  "0.15em": "tracking-[0.15em]",
  "0.16em": "tracking-[0.16em]",
} as const;

const SIZE = {
  10: "text-[10px]",
  11: "text-[11px]",
  12: "text-[12px]",
} as const;

export function MonoLabel({
  children,
  className,
  script = "content",
  size = 11,
  tracking = "0.12em",
  as: Comp = "span",
  "aria-hidden": ariaHidden,
}: {
  children: React.ReactNode;
  className?: string;
  script?: "latin" | "content";
  size?: keyof typeof SIZE;
  tracking?: keyof typeof TRACKING;
  as?: React.ElementType;
  "aria-hidden"?: boolean;
}) {
  return (
    <Comp
      aria-hidden={ariaHidden}
      className={cn(
        "font-jbmono",
        SIZE[size],
        TRACKING[tracking],
        script === "content" && "rtl:tracking-normal",
        className
      )}
    >
      {children}
    </Comp>
  );
}

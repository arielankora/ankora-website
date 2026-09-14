import Link from "next/link";
import { cn } from "@/lib/utils";

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
};

// Radius 0, no box-shadows, no gradients, no scale/lift on hover — sharp corners
// are the brand identity (see design_handoff_ankora_redesign/README.md, "Radius,
// shadow, motion"). This is a shared component used by both /he and /en, approved
// by Ariel for the redesign even though it's cross-locale; verify /en CTAs still
// read cleanly after this change.
export function Button({ href, children, variant = "primary", className }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 px-7 py-3.5 text-[15px] font-medium tracking-tight transition-colors duration-200 ease-out";

  const variants = {
    primary: "bg-gold text-ink hover:bg-gold-light",
    secondary:
      "border border-line text-paper hover:border-lineGold hover:text-gold-light bg-transparent",
    ghost: "text-paper/80 hover:text-gold-light",
  };

  return (
    <Link href={href} className={cn(base, variants[variant], className)}>
      {children}
    </Link>
  );
}

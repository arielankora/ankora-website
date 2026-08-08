import Link from "next/link";
import { cn } from "@/lib/utils";

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
};

export function Button({ href, children, variant = "primary", className }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-[15px] font-medium tracking-tight transition-all duration-200 ease-out";

  const variants = {
    primary:
      "bg-gold-gradient bg-[length:200%_100%] bg-[position:0%_0%] text-ink hover:bg-[position:100%_0%] hover:scale-[1.02] shadow-[0_0_0_1px_rgba(201,162,75,0.3)]",
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

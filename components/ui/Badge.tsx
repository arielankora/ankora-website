import { cn } from "@/lib/utils";

export function Badge({
  children,
  className,
  tone = "dark",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "dark" | "light";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]",
        tone === "light" ? "border-gold/50 text-gold" : "border-lineGold/60 text-gold-light",
        className
      )}
    >
      <span className={cn("h-1 w-1 rounded-full", tone === "light" ? "bg-gold" : "bg-gold-light")} />
      {children}
    </span>
  );
}

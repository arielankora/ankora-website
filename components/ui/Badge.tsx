import { cn } from "@/lib/utils";

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-lineGold/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-gold-light",
        className
      )}
    >
      <span className="h-1 w-1 rounded-full bg-gold-light" />
      {children}
    </span>
  );
}

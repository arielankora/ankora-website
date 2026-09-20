"use client";
import { signOut } from "next-auth/react";

// `variant="dark"` is used inside the Sidebar (navy background,
// redesign direction A) - the original light styling stays the default
// for anywhere still on a paper/white surface (e.g. BottomNav's "more"
// sheet).
export function LogoutButton({ variant = "light" }: { variant?: "light" | "dark" }) {
  const className =
    variant === "dark"
      ? "w-full rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-cream/70 transition-colors hover:border-gold hover:text-cream"
      : "rounded-full border border-lineDark px-4 py-2 text-xs font-medium text-appNavy/70 transition-colors hover:border-gold hover:text-appNavy";
  return (
    <button onClick={() => signOut({ callbackUrl: "/app/login" })} className={className}>
      התנתקות
    </button>
  );
}

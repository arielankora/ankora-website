"use client";
import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/app/login" })}
      className="rounded-full border border-lineDark px-4 py-2 text-xs font-medium text-navy/70 transition-colors hover:border-gold hover:text-navy"
    >
      התנתקות
    </button>
  );
}

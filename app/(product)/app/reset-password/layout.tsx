import type { ReactNode } from "react";
import { HebrewOnly } from "@/components/app/HebrewOnly";

// ADR 0006: the sign-in screens are not translated yet, so they keep
// their Hebrew direction for every reader instead of showing Hebrew text
// laid out left to right. This layout goes away when they are translated.
export default function SignInHebrewLayout({ children }: { children: ReactNode }) {
  return <HebrewOnly>{children}</HebrewOnly>;
}

import type { ReactNode } from "react";
import { HebrewOnly } from "@/components/app/HebrewOnly";

// ADR 0006: an agreement or a client's page stays in Hebrew for every
// reader. See components/app/HebrewOnly.tsx.
export default function HebrewOnlyLayout({ children }: { children: ReactNode }) {
  return <HebrewOnly>{children}</HebrewOnly>;
}

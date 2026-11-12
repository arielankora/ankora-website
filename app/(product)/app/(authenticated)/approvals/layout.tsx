import type { ReactNode } from "react";
import { ScopedMessages } from "@/components/app/ScopedMessages";

// ADR 0006, decision 7: this area's part of the dictionary in the browser.
export default function AreaLayout({ children }: { children: ReactNode }) {
  return <ScopedMessages area="approvals">{children}</ScopedMessages>;
}

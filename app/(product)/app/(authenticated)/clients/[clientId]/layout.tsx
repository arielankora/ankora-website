import type { ReactNode } from "react";
import { NoMachineTranslation } from "@/components/app/NoMachineTranslation";
import { aiExcludedClientIds } from "@/lib/app-domain/ai-exclusion-db";

// ADR 0006, "Content in English": every screen of a client marked "בלי AI"
// (the client page and all its tabs, the client file, connections,
// handover, procedures, a process's document and flow) is kept from the
// browser's translator. Here once, so a screen added under this client
// later is covered without anyone remembering to.
//
// Only the flag is read; whether the reader may see the client at all is
// each page's own question, and a page that refuses renders its refusal
// inside the same wrapper.
export default async function ClientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const excluded = (await aiExcludedClientIds([clientId])).has(clientId);
  return <NoMachineTranslation active={excluded}>{children}</NoMachineTranslation>;
}

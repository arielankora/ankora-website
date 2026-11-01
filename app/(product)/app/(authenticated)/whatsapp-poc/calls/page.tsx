import { redirect } from "next/navigation";

// 1.11.2026: the call recordings are part of the communications screen
// now, under its "שיחות טלפון" filter. This address stays for old links.
export default function WhatsappPocCallsPage() {
  redirect("/app/whatsapp-poc?filter=call");
}

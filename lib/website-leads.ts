import "server-only";
import { prisma } from "@/lib/prisma";
import {
  type Attribution,
  type ServerContext,
  describeSource,
  deviceFromUserAgent,
} from "@/lib/attribution";

export interface LeadInput {
  name: string;
  email: string;
  phone: string;
  areas: string[];
  message: string;
  company: string;
  locale: string;
}

/// Saves a contact request before the email is sent, so a request whose email
/// fails is still on record (emailStatus FAILED) instead of nowhere.
///
/// Returns the row id, or null when the database is unreachable. A database
/// failure must never cost the lead: the caller sends the email either way.
export async function saveWebsiteLead(
  lead: LeadInput,
  a: Attribution,
  ctx: ServerContext
): Promise<string | null> {
  try {
    const st = a.sessionTouch;
    const dev = deviceFromUserAgent(ctx.userAgent);
    const row = await prisma.websiteLead.create({
      data: {
        name: lead.name,
        email: lead.email,
        phone: lead.phone || null,
        areas: lead.areas,
        message: lead.message || null,
        company: lead.company || null,
        locale: lead.locale || null,
        source: st ? describeSource(st) : null,
        firstSource: a.firstTouch ? describeSource(a.firstTouch) : null,
        landingPage: st?.landing || null,
        referrer: st?.referrer || null,
        utmSource: st?.utm.utm_source ?? null,
        utmMedium: st?.utm.utm_medium ?? null,
        utmCampaign: st?.utm.utm_campaign ?? null,
        utmTerm: st?.utm.utm_term ?? null,
        utmContent: st?.utm.utm_content ?? null,
        gclid: st?.clickIds.gclid ?? null,
        visitNumber: a.visitNumber ?? null,
        firstSeenAt: a.firstTouch ? new Date(a.firstTouch.at) : null,
        visitStartedAt: st ? new Date(st.at) : null,
        gaClientId: a.gaClientId ?? null,
        gaSessionId: a.gaSessionId ?? null,
        country: ctx.country ?? null,
        region: ctx.region ?? null,
        city: ctx.city ?? null,
        deviceType: dev.type === "unknown" ? null : dev.type,
        os: dev.os || null,
        browser: dev.browser || null,
        userAgent: ctx.userAgent ?? null,
        attribution: a as object,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error("website lead save failed (the email is still sent):", err);
    return null;
  }
}

export async function markLeadEmail(id: string | null, status: "SENT" | "FAILED") {
  if (!id) return;
  await prisma.websiteLead.update({ where: { id }, data: { emailStatus: status } });
}

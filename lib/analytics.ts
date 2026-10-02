/**
 * The contact funnel, as GA4 events (SEO/GEO audit follow-up, 1.10.2026):
 *
 *   page_view ............... any page (GA4 automatic)
 *   cta_click ............... a click on any link to /contact (CtaTracking)
 *   page_view /contact ...... GA4 automatic
 *   contact_form_start ...... first interaction with any field
 *   contact_form_field ...... each field completed, once (where people stop)
 *   contact_form_submit ..... the submit button pressed (attempt)
 *   contact_form_invalid .... the browser blocked the submit (empty required field)
 *   contact_form_error ...... the server or network refused it
 *   generate_lead ........... the server accepted it (the key event), with channel
 *
 * Added with the contact page redesign (2.10.2026), outside the funnel steps:
 *   contact_channel_click ... the direct WhatsApp or email link (leaves the form;
 *                             never counted as a lead). channel: whatsapp_link | email_link
 *   booking_open ............ the booking calendar opened after an accepted request.
 *                             Google does not report the booking itself.
 *
 * gtag is absent for automated browsers (see app/[locale]/layout.tsx), and
 * analytics must never break the page, so every call is guarded.
 */
type Params = Record<string, string | number | boolean | undefined>;

export function track(event: string, params: Params = {}) {
  try {
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    gtag?.("event", event, params);
  } catch {
    // Analytics is never allowed to break the page.
  }
}

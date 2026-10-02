/**
 * The two direct routes on the contact page, in one place.
 *
 * WHATSAPP_URL opens a chat with Ankora's WhatsApp number (052-8549835). It leaves
 * the site, so it is tracked as contact_channel_click and never as generate_lead.
 *
 * BOOKING_EMBED_URL is Ariel's Google Calendar booking page (appointment schedule
 * "30 min with Ariel (Ankora)", short link calendar.app.google/PvjgmqK21PuXWrYRA)
 * in Google's embed form (`?gv=true`), shown inside the page as step 2, as soon as
 * the form is accepted, so the lead is already saved whether or not a time is booked. The
 * frame is Google's and cannot be styled. Google does not report bookings back to
 * the site: the site measures booking_open, and actual bookings are seen in the
 * calendar. next.config.mjs allows https://calendar.google.com in frame-src.
 */
export const WHATSAPP_URL = "https://wa.me/972528549835";
export const BOOKING_EMBED_URL =
  "https://calendar.google.com/calendar/appointments/schedules/AcZssZ0W5GIKBxb8GAPTjsbSNtoEnsaM3ohWlL4gZjw1FL6KR8pbEjXGZ_Pm_2eHJkJ8wuho4m0__HBc?gv=true";

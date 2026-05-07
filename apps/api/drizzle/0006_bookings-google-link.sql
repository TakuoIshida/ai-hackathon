-- ISH-269: persist Google Calendar event htmlLink alongside the existing
-- google_event_id, so the booking detail page can deeplink straight to the
-- real event instead of best-effort opening the new-event-create form.
--
-- The column is nullable because:
--   1. existing rows pre-dating this migration carry no link
--   2. the calendar-sync block in confirmBooking is best-effort: a booking
--      may be confirmed without a Google event (Google disabled / oauth
--      missing / events.insert failure)

ALTER TABLE "tenant"."bookings"
	ADD COLUMN "google_html_link" text;

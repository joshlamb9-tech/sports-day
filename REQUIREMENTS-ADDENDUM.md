# Requirements addendum (from Josh, during build)

## Admin / control-room page  — REQUIRED

A dedicated **Admin** view for the organiser — distinct from the public Spectator board. It must show
"the scores, winners and all the behind-the-scenes calculations". Concretely:

- **Full house standings** with the maths shown — not just the total, but how each house's total is
  built up (points contributed per event / per age group). Nothing should be a black box.
- **Winners**, computed and clearly declared:
  - Overall winning house.
  - Per age-group / per-band winners (if configured).
  - Individual champions — Victor / Victrix Ludorum per age group (if individual tracking is on).
- **Calculation transparency**: show the active points scheme (position → points), how ties are
  handled, and any manual adjustments, so Josh can trust and defend the numbers.
- **Per-event results table**: every event, its finishing order, the house each place went to, and the
  points awarded.
- **Corrections**: edit / fix / re-record a result and have totals recompute live.
- **Export / print**: low-ink printable results summary (and ideally CSV) for sharing / records.

This is the organiser's source of truth. The Spectator board stays a clean, read-only crowd view; the
Admin page is where everything is visible and editable.

Screen model is now: **Setup · Record · Admin (full) · Spectator (public)**.

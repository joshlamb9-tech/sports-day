# Sports Day

A live, central scoring app for school sports day. Teachers record event results from their own
phones at each event station; results sync to a central live leaderboard, points are applied
automatically, and house standings update in real time.

Built for Mowden Hall School, but **fully configurable** — houses, events, age groups and the
points-per-place scheme are all set up on a setup screen, nothing is hardcoded, so it's reusable
every year (and by any school).

## Stack

- **Front end:** static single-page app (vanilla JS, no build step) hosted on GitHub Pages.
- **Back end:** Supabase (Postgres + Realtime) — shared "Caerus" project, tables namespaced `sportsday_`.
- **Live updates:** Supabase Realtime — recorders write results, every connected leaderboard/spectator
  screen updates instantly.
- **Offline tolerance:** result entries queue locally on the recorder's device and sync when the
  connection returns, so a patchy school-field signal never loses a result.

## Roles / screens

- **Setup** — configure the meet: houses, events, age groups/categories, points scheme, recorder PIN.
- **Record** — a recorder picks an event and taps in the finishing order in seconds. Mobile-first.
- **Leaderboard** — the live central standings (house totals), for staff.
- **Spectator** — a read-only, big-screen-friendly view of the standings for the crowd.

## Layout

```
index.html            # single-page app shell
assets/css/styles.css # design system + screens (Dosis, low-ink print)
assets/js/config.js   # Supabase connection (public anon key + Realtime)
assets/js/*.js         # app logic (setup, record, scoring, realtime, offline queue)
supabase/             # SQL migrations / edge functions
BUILD-SPEC.md         # the authoritative build specification
```

## Deploy

GitHub Pages serves the repo root on `main` (no build step, no Actions workflow — same pattern as
the Entrepreneurs Club app). Push to `main` → live at `https://joshlamb9-tech.github.io/sports-day/`.

## Configuration

Supabase URL + public anon key live in `assets/js/config.js`. The anon key is meant to be public;
Row Level Security on the `sportsday_` tables is what protects the data. See `.env.example`.

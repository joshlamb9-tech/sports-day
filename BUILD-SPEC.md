# Sports Day — Build Specification (v1, authoritative)

**Summary.** A static single-page web app (vanilla JS, no build step) on GitHub Pages, backed by Supabase (Postgres + Realtime) in the shared **Caerus** project, that lets teachers record sports-day results from their phones at each event station and shows a never-wrong, live house leaderboard. Teachers tap finishing order; points are applied automatically from a fully configurable scheme; every connected screen updates in real time. Every result write is queued locally first so a patchy school-field signal can never lose a result, and all published totals are computed from committed server rows so the central number is always correct. Four screens: **Setup · Record · Admin (full control-room) · Spectator (public, read-only)**. Built for Mowden Hall (four houses, Years 3–8) but fully configurable for reuse.

> ### v1 scope vs v2 later
>
> | Area | **v1 (build now)** | **v2 (later)** |
> |---|---|---|
> | Result entry | Tap houses in finishing order; per-event finish list; corrections | Times/distances with auto-rank for field events |
> | Live sync | Supabase Realtime + 20s safety-poll + last-good cache | Presence (who's recording what) |
> | Offline | localStorage outbox, idempotent client-UUID upsert, auto-flush | Service worker / PWA (cold-load with no signal) |
> | Scoring | Configurable position→points, ties (split / shared), per-event override | Per-event scheme weighting UI polish |
> | Champions | **Victor / Victrix Ludorum per age group, IF `track_individual` on** (cheap: schema already carries `athlete_name`) | Roster import from iSAMS/NFC, validated athlete picker |
> | Records | — | "New record!" detection + records ticker |
> | Heats | — | Heats → finals qualification model |
> | Access | Shared recorder PIN + admin PIN (soft gate) + RLS | Magic-link staff auth if PIN proves leaky |
> | Export | Low-ink printable results sheet + CSV | Google Sheets push, year-on-year history |

---

## 1. Decisions resolved (where the proposals disagreed)

The three proposals (Tally / Victor Ludorum / Field-Proof) agreed on more than they disagreed. Where they diverged, and where they conflict with the existing repo scaffolding, here is the ruling and why. **The existing repo (`config.js`, the init migration, `README.md`, `REQUIREMENTS-ADDENDUM.md`) is ground truth and overrides the generic RECON conventions** — the RECON was extracted from a *different* project (`jkbfvfoepmhwyzhleifh`, `sd_` tables, no client lib, poll-only). This project has already chosen otherwise. Do not "fix" the spec back toward the RECON.

| # | Disagreement | Ruling | Why |
|---|---|---|---|
| 1 | **Supabase project + table prefix.** RECON says `jkbfvfoepmhwyzhleifh` / `sd_`. | **Caerus `dlcseuejvducbsjhqvze`, tables `sportsday_`.** | The repo's `config.js`, `.env.example` and applied migration already commit to this. Changing it now would orphan the live migration. The builder leaves the concrete project id as-is (it is already set); a fresh deploy would treat it as a TODO. |
| 2 | **Realtime vs poll-only.** RECON + two proposals lean poll-only (no websockets); the repo's `config.js` already builds a Realtime-enabled supabase-js client. | **Realtime is primary, with a 20s safety-poll and last-good cache as the floor.** | The repo already wired supabase-js v2 with Realtime. A sports day has many writers and one watched board — Realtime is the right transport for "the board moves the instant a result lands." But Realtime alone is fragile on field wifi, so it is *layered over* a self-healing poll, never a sole dependency. This is the Field-Proof proposal's "Realtime as accelerator, polling as floor" — applied with Realtime genuinely on. |
| 3 | **supabase-js client vs raw `fetch`.** RECON says fetch-only, no client lib. | **Use supabase-js v2 UMD (CDN).** | Already chosen in `config.js`. It gives clean Realtime subscriptions and `.upsert(..., { onConflict })` for idempotent offline replay without hand-rolling the phoenix protocol. Still "no build step" — it's one CDN `<script>`. |
| 4 | **House-only vs athlete-level results.** Tally records house+position only; Victor Ludorum records per athlete. | **Position→house is the load-bearing unit; `athlete_name` is optional free text on the same row.** | House totals — the non-negotiable — need only `(event, position, house)`. Capturing optional `athlete_name` on the *same* row makes Victor/Victrix Ludorum a free `SUM(points) GROUP BY athlete_name` with no schema change and no roster import. Best of both: 4-tap recording, champions for free when wanted. |
| 5 | **Computed-on-read vs stored points.** Some proposals denormalise `points` onto each result row. | **Do NOT store points on the row. Compute points centrally at read time from the meet's scheme.** | The Admin requirement demands "no black box — show how each total is built." Computing from `(position, scheme, tie_policy)` on read means a single source of truth, correct ties, and a scheme edit re-scores instantly with no migration of historical rows. Volume is tiny (a few hundred result rows), so read-time compute is free. This is the deliberate reversal of the "denormalise for dumb-SUM board" idea — Admin transparency wins, and the data set is small enough that it costs nothing. |
| 6 | **Corrections: append-only supersede vs in-place edit.** | **In-place: a result is a row; correcting it UPDATEs `position`/`house_id`/`athlete_name` or soft-`voided` it.** Re-recording an event deletes that event's rows and re-inserts. | The repo's migration models `sportsday_results` as one row per placed position with `client_uuid UNIQUE` for idempotency, not as an append-only log. In-place edit + `voided` flag is simpler, the audit need is met by Admin showing current state, and totals stay trivially correct because they sum only `voided = false` rows. (Append-only was over-engineering for a few-hundred-row day.) Add `voided`, `points` is NOT added. |
| 7 | **One edge function for integrity vs none.** Tally/Field-Proof add an `insert-result`/`manage-meet` function so points can't be forged and config can't be publicly rewritten. | **v1: NO edge function. Direct REST via supabase-js, protected by RLS + PIN-gated client.** Flagged as an accepted risk. | The current migration grants anon full CRUD with `using(true)`. For a one-day, trusted-staff, non-sensitive event the threat model is "a bored pupil," not a determined attacker. Adding a function is the single cleanest hardening if Josh wants it (see §6 + flag F4) — but it is not required for the day to work, and the brief says "no heavy auth." Keep v1 functionless; tighten RLS as below. |
| 8 | **Tie default.** Proposals split between `split` (average) and `shared` (full + skip). Repo default is `split`. | **Honour repo default `tie_policy = 'split'`, expose both in Setup.** | Already the migration default. Both implemented in the shared scoring function; organiser picks. |
| 9 | **Number of screens.** Proposals describe 3. | **Four: Setup · Record · Admin · Spectator.** | `REQUIREMENTS-ADDENDUM.md` makes the Admin control-room a hard requirement, distinct from the public Spectator board. |

---

## 2. Tech stack & conventions (honour all of these)

- **Language:** Vanilla JavaScript, ES5/ES6 IIFE-per-file pattern (`(function(){ 'use strict'; ... })()`), no framework.
- **Build tool:** none. Static HTML/CSS/JS served as-is.
- **Supabase client:** supabase-js v2 UMD from CDN (already in `config.js`). One shared lazily-created client via `window.SD.sbClient()`. Realtime enabled, `auth.persistSession = false`.
- **External libs:** CDN `<script>` only. Confetti: `https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js`.
- **Font:** **Dosis** (Google Fonts), already the design-system font (`--font`). Mandatory.
  `@import url('https://fonts.googleapis.com/css2?family=Dosis:wght@300;400;500;600;700;800&display=swap');`
- **Design system:** already built in `assets/css/styles.css` — warm-paper light "field" theme + dark "stadium" theme, track-coral primary `#FF5234`, 4px spacing scale, house colours as the leaderboard heroes. **Reuse the existing tokens; do not invent a parallel palette.**
- **House colours (exact, from `nfc-house-points/src/theme.ts`, Mowden Brand Guidelines 2025):** Collingwood `#C0392B` (red), Grey `#27AE60` (green), Stephenson `#D4A017` (gold), Bewick `#2471A3` (blue). Pre-seed these in Setup.
- **Low-ink print:** print styles for the Admin/Spectator results sheet — white background, light-grey table lines only, house colour confined to the name cell, Dosis. No coloured fills in body. (Memory: print economy is non-negotiable for printed sheets.)
- **No `.env` in client, no `package.json`, no `node_modules`, no Vite/Webpack, no GitHub Actions workflow.** Anon key is public and lives in `config.js`; `.env.example` documents it for humans only.
- **Naming:** tables `snake_case` plural with `sportsday_` prefix; JS files descriptive (`record.js`, `scoring.js`); HTML ids/classes `kebab-case`.
- **Terminology:** "House" (capitalised proper noun), "Year Group" (numeric Y3–Y8), age-group/band labels free text ("Junior Y3–6", "Senior Y7–8", "Y3"). Spell out "Year 7 / Year 8" in any prose, never "Y7".

---

## 3. File & folder layout

Repo root: `/Users/josh/projects/sports-day/` → GitHub Pages from `main`, repo root, no `docs/`, no workflow.
**Live URL pattern:** `https://joshlamb9-tech.github.io/sports-day/`
Screen URLs (hash-routed, one shell): `…/sports-day/#/setup`, `#/record`, `#/admin`, `#/` (Spectator = default).

```
sports-day/
├── index.html                  # single-page shell; hash router mounts the 4 views
├── README.md                   # (exists)
├── REQUIREMENTS-ADDENDUM.md    # (exists — Admin control-room requirement)
├── BUILD-SPEC.md               # this file
├── .env.example                # (exists — documents Caerus URL + anon key)
├── .gitignore                  # (exists)
├── assets/
│   ├── css/
│   │   └── styles.css          # (exists) design system + per-screen styles + low-ink @media print
│   └── js/
│       ├── config.js           # (exists) Supabase connection + shared client (window.SD.sbClient)
│       ├── router.js           # hash router; shows/hides view containers; reads ?code= / ?pin=
│       ├── store.js            # in-memory state: meet, houses, ageGroups, events, results; load + cache
│       ├── scoring.js          # PURE scoring engine (position→points, ties, totals, champions)
│       ├── queue.js            # offline outbox: localStorage queue + idempotent flush + backoff
│       ├── realtime.js         # Realtime subscribe + 20s safety-poll + last-good cache; emits 'sd:data-changed'
│       ├── setup.js            # Setup screen logic
│       ├── record.js           # Record screen logic (the workhorse)
│       ├── admin.js            # Admin control-room logic (totals breakdown, corrections, export)
│       ├── spectator.js        # Spectator big-screen logic (read-only)
│       └── export.js           # low-ink print sheet + CSV builder (shared by Admin)
└── supabase/
    └── migrations/
        ├── 20260615120000_sportsday_init_schema.sql   # (exists)
        └── 20260615T_add_voided_and_tighten_rls.sql   # (new — see §4.2)
```

Load order in `index.html` (`<body>` end):
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>
<script src="assets/js/config.js"></script>
<script src="assets/js/scoring.js"></script>
<script src="assets/js/store.js"></script>
<script src="assets/js/queue.js"></script>
<script src="assets/js/realtime.js"></script>
<script src="assets/js/export.js"></script>
<script src="assets/js/setup.js"></script>
<script src="assets/js/record.js"></script>
<script src="assets/js/admin.js"></script>
<script src="assets/js/spectator.js"></script>
<script src="assets/js/router.js"></script>
```

---

## 4. Supabase schema

### 4.1 Existing tables (migration `20260615120000`, already applied)

All in the shared Caerus project `dlcseuejvducbsjhqvze`, public schema, `sportsday_` prefix, RLS enabled.

**`sportsday_meets`** — one row per sports day; holds all meet-level config.

| column | type | notes |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `name` | text NOT NULL | e.g. "Mowden Sports Day 2026" |
| `event_date` | date | |
| `status` | text NOT NULL default `'setup'` | `setup` \| `live` \| `finished` |
| `points_scheme` | jsonb NOT NULL default `{"1":5,"2":3,"3":1}` | position→points; fully editable |
| `tie_policy` | text NOT NULL default `'split'` | `split` (average) \| `shared` (full + skip) |
| `track_individual` | boolean NOT NULL default `true` | enables Victor/Victrix Ludorum |
| `recorder_pin` | text | soft gate for Record screen |
| `admin_pin` | text | soft gate for Setup + Admin |
| `created_at` / `updated_at` | timestamptz NOT NULL default `now()` | `updated_at` via trigger |

**`sportsday_houses`** — `id` uuid PK · `meet_id` uuid FK→meets ON DELETE CASCADE · `name` text · `colour` text default `'#888888'` · `sort` int · `created_at`. Seed Mowden's four.

**`sportsday_age_groups`** — `id` uuid PK · `meet_id` FK→meets · `label` text · `sort` int · `created_at`. Configurable bands.

**`sportsday_events`** — `id` uuid PK · `meet_id` FK→meets · `name` text · `discipline` text default `'track'` (`track`\|`field`\|`relay`\|`other`) · `age_group_id` uuid FK→age_groups ON DELETE SET NULL · `category` text default `'mixed'` (`boys`\|`girls`\|`mixed`) · `is_relay` boolean · `sort` int · `status` text default `'pending'` (`pending`\|`recording`\|`done`) · `created_at`.

**`sportsday_results`** — one row per placed position in an event (ties allowed: two rows can share `position`).

| column | type | notes |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `meet_id` | uuid NOT NULL FK→meets ON DELETE CASCADE | denormalised for cheap Realtime filter |
| `event_id` | uuid NOT NULL FK→events ON DELETE CASCADE | |
| `position` | int NOT NULL | 1 = first; ties share a value |
| `house_id` | uuid NOT NULL FK→houses ON DELETE CASCADE | |
| `athlete_name` | text NULL | optional → Victor/Victrix Ludorum for free |
| `recorded_by` | text NULL | recorder label, e.g. "Mr Lamb / Track A" |
| `client_uuid` | text **UNIQUE** | **idempotency key** — `crypto.randomUUID()` on the device; replay of a queued write is a no-op |
| `created_at` | timestamptz default `now()` | |

Indexes: `sportsday_results(meet_id)`, `sportsday_results(event_id)`, `sportsday_houses(meet_id)`, `sportsday_events(meet_id)`, `sportsday_age_groups(meet_id)`. `client_uuid` is unique (idempotent upsert target).

> **NOTE — no `points` column.** Points are computed at read time by `scoring.js` from `points_scheme` + `tie_policy` (Decision #5). This keeps a single source of truth and makes scheme edits instant.

### 4.2 New migration `20260615T_add_voided_and_tighten_rls.sql` (build this)

1. **Add soft-delete + ordering helpers to results:**
   ```sql
   alter table sportsday_results
     add column if not exists voided boolean not null default false;
   create index if not exists sportsday_results_live_idx
     on sportsday_results (meet_id, event_id) where voided = false;
   ```
2. **Enable Realtime** on the live table:
   ```sql
   alter publication supabase_realtime add table sportsday_results;
   alter publication supabase_realtime add table sportsday_events;
   alter publication supabase_realtime add table sportsday_meets;
   ```
   (Wrap each in a `do $$ ... exception when duplicate_object then null; end $$;` guard so re-runs are safe.)
3. **Tighten RLS** from the current blanket `using(true)` all-CRUD. Keep it light (no auth) but remove the worst foot-guns:
   - `sportsday_results`: anon **SELECT** = true; anon **INSERT** allowed only `WITH CHECK (meet_id IN (SELECT id FROM sportsday_meets WHERE status = 'live'))`; anon **UPDATE** allowed (corrections + void) on live meets; **no DELETE for anon** (corrections use `voided`, re-records delete via admin path — see flag F4).
   - Config tables (`meets`/`houses`/`age_groups`/`events`): anon **SELECT** = true. INSERT/UPDATE/DELETE stay anon-permitted in v1 (Setup has no server gate), **flagged F4** — the clean hardening is to move config writes behind a PIN-checked edge function. Document this in the migration comment so it is a conscious choice, not an oversight.

   Implement by dropping the generic `_anon_all` policies and creating explicit per-operation policies as above.

### 4.3 Derived data (computed in JS, not stored)

- **House totals** = for each event, rank its `voided=false` rows by `position`, award `pointsFor(position, scheme, tiePolicy, tieGroupSize)`, sum per `house_id`.
- **Per-event / per-age-group breakdown** = the same award table, grouped for the Admin transparency view.
- **Victor / Victrix Ludorum** (if `track_individual`) = `SUM(points) GROUP BY athlete_name` within each age group, top male/female by however the recorder labelled them. v1 treats "athlete with most points per age group" as the champion; gender split is a v2 nicety unless athletes are entered with a gender hint. (Relay rows usually have no `athlete_name`, so they credit the house only — correct.)

---

## 5. The scoring engine (`scoring.js`, pure functions)

No DB, no DOM — pure, unit-testable, used identically by Record (optimistic preview), Admin (authoritative breakdown) and Spectator.

```
pointsFor(position, scheme, tiePolicy, tieGroupSize) -> int
```
- `scheme` is the `points_scheme` object, e.g. `{ "1":5, "2":3, "3":1 }`. A position beyond the scheme scores **0** (4th in a 5/3/1 scheme = 0).
- **Ties.** When `tieGroupSize > 1` houses share a `position`:
  - `tiePolicy = 'split'` (default): the tied houses share the **sum of the contested places' points**, divided equally. Two tied for 1st in 5/3/1 → each gets `(5+3)/2 = 4`; the next finisher is 3rd (gets 1). Athletics-accurate.
  - `tiePolicy = 'shared'`: each tied house gets the **full** points for the shared (higher) place, and the next place(s) are skipped. Two tied for 1st → each gets 5; next finisher is 3rd. Kinder, simpler to explain at prize-giving.
- Implementation: rank rows by `position`; for each distinct position value, count the tie group, compute the per-house award once, apply to all members.

```
computeEventAwards(eventResults, scheme, tiePolicy) -> [{ house_id, position, points, athlete_name }]
computeHouseTotals(allResults, eventsById, meet) -> [{ house_id, total }]  // sorted desc, ties share rank with '=' marker
computeChampions(allResults, ageGroupsById, meet) -> { [ageGroupId]: [{ athlete_name, house_id, total }] }
```

All consumers call these over the **same in-memory `results` array** that `store.js` holds (filtered `voided=false`). Because totals are derived, an in-flight queued result simply isn't summed until it commits — the published total is never a partial/wrong number.

---

## 6. Access control (light, no heavy auth)

- **No accounts.** Anon key (public) ships in `config.js`; RLS is the real boundary.
- **Two PINs on the meet row.** `recorder_pin` gates the Record screen; `admin_pin` gates Setup + Admin. Entered once, cached in `localStorage` (`sd:role`, `sd:recorder_pin`, `sd:admin_pin`). PIN check is **client-side UX only** — its job is to stop a bored pupil/parent typing scores, not a determined attacker. Recorder link can carry `?code=<recorder_pin>` so Josh hands out a one-tap URL (auto-copy to clipboard on the Setup "copy recorder link" button — matches Josh's auto-copy-URL preference).
- **Spectator = read-only by construction.** The Spectator view (`#/`) renders only from `scoring.js` over fetched rows and ships **no write code paths at all**. Even with the anon key, it cannot mutate because the mutation code isn't loaded on that route.
- **RLS floor** (§4.2): writes to `sportsday_results` only land while the meet is `status='live'`; no anon DELETE; config tables are SELECT-open. Lock the day by setting `status='finished'` — the Record screen checks this and refuses, and RLS rejects late writes.
- **Accepted risk (flag F4):** a determined insider with the page source could craft result inserts or rewrite config. For a one-day, trusted-staff, non-sensitive event this is acceptable and is the brief's "no heavy auth." The clean hardening, if wanted, is one edge function (`manage-meet`, `verify_jwt=false`, CORS per convention) that checks `admin_pin`/`recorder_pin` server-side before config writes and result inserts. Not in v1.

---

## 7. Realtime + offline + graceful degradation

This is the make-or-break. Three layers, belt-and-braces.

### 7.1 Offline outbox (`queue.js`) — every write goes local first
1. On "Save result", build the result object(s) for the event, each stamped with `client_uuid = crypto.randomUUID()` and `recorded_by`.
2. Push to `localStorage` key `sd:outbox` (an array) **and render the optimistic UI immediately** (green tick, event marked done). The teacher's job is done the instant they tap — the UI never waits on the network.
3. Kick the flusher: for each queued item, `supabase.from('sportsday_results').upsert(rows, { onConflict: 'client_uuid', ignoreDuplicates: true })`. On success, remove from outbox. On network error, leave it and retry.
4. **Idempotency:** because `client_uuid` is UNIQUE and we upsert on it, a retry after an unseen success is a harmless no-op. **This is the single most important reliability rule** — it makes flaky retries safe and guarantees no duplicate points.
5. **Retry triggers:** exponential backoff (2s → 5s → 15s → 30s cap), plus `window.addEventListener('online', flush)`, plus flush on `document.visibilitychange` (teacher pockets phone, walks to signal, reopens → auto-syncs). Use `keepalive: true` on the final flush attempt where possible.
6. **Sync status chip** (Record screen, always visible): "Synced" (green) / "N waiting" (amber) / "Offline — saved on phone" (grey). A teacher knows to wander toward signal before leaving.

### 7.2 Live sync (`realtime.js`) — Realtime primary, poll as floor
- **Primary:** subscribe to `postgres_changes` on `sportsday_results` (and `sportsday_events`, `sportsday_meets`) filtered `meet_id=eq.<id>` via the supabase-js channel `sd-meet-<meet_id>`. On any INSERT/UPDATE, re-fetch the affected slice (or the whole small result set — it's tiny) into `store.js` and emit a `sd:data-changed` event. Admin/Spectator/Leaderboard listen and re-render.
- **Floor (safety-poll):** a 20s `setInterval` re-fetches `sportsday_results` for the meet regardless of socket health. If the websocket silently dropped on field wifi (it will), the board is never more than 20s stale. This is the deliberate "Realtime accelerator, polling floor" call (Decision #2).
- **Recorders do NOT subscribe** to Realtime — they are write-mostly. Saves connections on the shared Caerus project. They only need to know their *own* event statuses, which they hold optimistically.

### 7.3 Graceful degradation — the board never shows a wrong number
- Each successful fetch caches `sd:last-totals` (computed) + timestamp to `localStorage`.
- On fetch failure, the board renders the **last-good** totals plus a muted badge "reconnecting · last updated HH:MM" — it never blanks and never shows a partial/flickering sum.
- Because totals are derived from committed `voided=false` rows only, a queued-but-not-yet-synced result on someone's phone simply isn't counted centrally yet — which is correct (it hasn't officially happened), not a bug.

### 7.4 Conflict handling
- **Two teachers, different heats of one event:** both inserts land (different `client_uuid`); both count. Correct.
- **Two teachers record the SAME real race:** both land; Admin sees two finish-lists for one event in the drill-down and **voids** the wrong one with a tap (sets `voided=true`). Non-destructive, auditable.
- **One teacher correcting a placing:** UPDATE the row's `position`/`house_id`, or void + re-enter. Totals recompute live because they sum current `voided=false` rows. No merge logic needed — the aggregate self-heals.

---

## 8. Screens (mobile-first flows)

One `index.html` shell. `router.js` reads the hash and shows the matching `<section>` container, lazy-initialising that screen's module. Default route (`#/`) = Spectator.

### 8.1 Setup — `#/setup` (admin-PIN gated; laptop the night before, but mobile-safe)
**Purpose:** configure the meet, generate the recorder link, go live.
**Flow (accordion / tabbed sections):**
1. **Meet:** name, date. Points-scheme editor — a small grid "1st [5] 2nd [3] 3rd [1]", `+ add place`, defaults pre-filled `5/3/1` (**flag F1** — confirm Mowden's real scheme). Tie policy radio (`split` default). `track_individual` toggle.
2. **Houses:** pre-filled with Mowden's four (name + colour swatch using exact hexes); add / rename / reorder / recolour.
3. **Age groups:** pre-filled "Junior Y3–6" / "Senior Y7–8" (and optionally per-year); editable, reorderable.
4. **Events:** table — name, discipline, age-group dropdown, category (boys/girls/mixed), relay toggle; `+ add event`, duplicate-row button for the common "same race × 4 categories" case, drag-reorder.
5. **PINs:** set `recorder_pin` + `admin_pin`.
6. **Go Live** button → `status='live'`. Then: **"Copy recorder link"** (puts `…/#/record?code=<recorder_pin>` on clipboard) and **"Print event sheet"** (low-ink A4 listing every event with blank 1st/2nd/3rd lines — paper fallback if a phone dies).
- Writes go straight to Supabase via supabase-js; if offline at setup, cache to `localStorage` and warn "config not yet synced."

### 8.2 Record — `#/record` (recorder-PIN gated; the workhorse, one thumb, sun glare)
**Purpose:** log an event's finishing order in seconds.
**Flow:**
1. One-time PIN (pre-filled from `?code=`), remembered. Optional `recorded_by` label, remembered.
2. **Event picker:** large cards grouped by age group, colour-accented, search box for long lists; events already `done` show a tick and grey out.
3. **Record card:** event name header, then a row of **four big house-coloured tiles**. Tap the winning house → it stamps "1st" and locks; tap the next → "2nd"; again → "3rd". Live preview shows "🥇 Collingwood 5 · 🥈 Bewick 3 · 🥉 Grey 1" using `scoring.js`. Ties: tap two houses for the same place via a "tie" affordance. Relay events: identical (tiles are houses, not athletes). If `track_individual`, an optional name field per place (skippable).
4. **Save result** → optimistic green tick, event → `done`, write to outbox (§7.1), card resets. ~5 taps for a 3-place race, well under 15s.
5. **My results / undo** list (this device): recent submissions with Void / Correct (re-opens the card; writes update or void).
6. Persistent **sync status chip** (§7.1). High contrast, large text, no tiny targets.

### 8.3 Admin — `#/admin` (admin-PIN gated; the organiser's source of truth) — **REQUIRED**
**Purpose:** everything visible, nothing a black box; editable; exportable. (Per `REQUIREMENTS-ADDENDUM.md`.)
**Sections:**
1. **House standings with the maths shown:** each house's total **and its build-up** — points contributed per event and per age group, not just the headline number. Expandable rows.
2. **Winners, computed & declared:** overall winning house; per-age-group/band winners (if configured); Victor/Victrix Ludorum per age group (if `track_individual`).
3. **Calculation transparency panel:** the active points scheme, the tie policy in force and how it resolves, and a list of any manual voids/adjustments.
4. **Per-event results table:** every event, finishing order, house per place, points awarded — with **Correct / Void / Re-record** actions that recompute totals live.
5. **Export / print:** low-ink printable results summary (`window.print()` against print CSS) **and** CSV download (`export.js`).
- Reads the same `store.js` data; subscribes to Realtime; re-renders on `sd:data-changed`. This is where corrections happen.

### 8.4 Spectator — `#/` (no gate; big-screen, read-only)
**Purpose:** the crowd / marquee TV view; also shareable link for parents.
**Flow:** four house bars (height/width = live total, house colour, big numbers, leader crowned); auto-rotates between Overall and each age group every ~12s; confetti (CDN lib) when the rank-1 house changes between two refreshes; uses dark "stadium" theme for projection. **No inputs, no write code.** Graceful degradation badge (§7.3) on fetch failure. A "Final Results" low-ink print sheet is reachable here too for prize-giving.

---

## 9. Build order (phases)

**Phase 0 — Schema finalise.** Write & apply migration `20260615T_add_voided_and_tighten_rls.sql` (add `voided` + live index, enable Realtime publication, tighten RLS per §4.2). Verify with the Supabase MCP `list_tables` / `get_advisors`.

**Phase 1 — Foundations.** `index.html` shell + the four `<section>` containers; `router.js` (hash routing, `?code=`/PIN reading); confirm `config.js` client works (a trivial `select` from `sportsday_meets`). Wire Dosis + existing `styles.css`.

**Phase 2 — Scoring engine (`scoring.js`).** Pure functions: `pointsFor`, `computeEventAwards`, `computeHouseTotals`, `computeChampions`. Hand-test both tie policies and the "beyond-scheme = 0" rule against worked examples before any UI depends on them. (This is the correctness core — get it right first.)

**Phase 3 — Setup screen.** Config CRUD against Supabase; Mowden defaults pre-seeded (4 houses + hexes, Junior/Senior bands, 5/3/1, `split`); Go Live; copy-recorder-link; print event sheet. End state: a meet can be fully configured and set `live`.

**Phase 4 — Offline outbox + Record screen.** `queue.js` first (localStorage outbox, idempotent `upsert onConflict client_uuid`, backoff + online/visibility flush, sync chip), then `record.js` (event picker, tap-finishing-order tiles, optimistic save, my-results/undo). **Acceptance gate: record results with the phone in airplane mode, re-enable network, confirm exactly-once sync (no duplicate points).**

**Phase 5 — Realtime + Leaderboard/Spectator.** `realtime.js` (subscribe + 20s safety-poll + last-good cache + `sd:data-changed`). `spectator.js` big-screen board, house bars, rotation, confetti on lead change, degradation badge. Acceptance: two devices — record on one, board updates on the other within Realtime latency, and within 20s even with Realtime killed.

**Phase 6 — Admin control-room (`admin.js`).** Standings-with-build-up, winners + champions, transparency panel, per-event table, Correct/Void/Re-record (live recompute). `export.js` low-ink print sheet + CSV. This is the organiser's source of truth and the addendum requirement.

**Phase 7 — Hardening & dry run.** End-to-end rehearsal with ~40 events across age groups on at least two phones: airplane-mode queue test, double-record → void test, scheme-edit-re-scores test, lock-the-day (`status='finished'`) test, print + CSV check, projector check of Spectator. Confirm flags F1/F2/F3 with Josh.

**Phase 8 — Deploy.** Push to `main`; enable GitHub Pages (deploy from `main`, repo root, no workflow); verify `https://joshlamb9-tech.github.io/sports-day/`.

---

## 10. Flags needing Josh's input (confirm before the day)

- **F1 — Points scheme.** `5/3/1` is a prep-school assumption, NOT sourced Mowden fact (RECON gap). Highest-impact unknown: if wrong, every total is wrong. Fully configurable + flagged in Setup; **confirm Mowden's actual 1st/2nd/3rd scheme** (and whether any event scores deeper, e.g. finals).
- **F2 — Age-group banding & gender split at the event.** Are events run Junior (Y3–6) / Senior (Y7–8), per-year, or a mix? Are events mixed, or split boys/girls? Setup is configurable either way, but the defaults should match the actual day so setup is fast.
- **F3 — Victor / Victrix Ludorum.** No evidence Mowden awards individual champions (RECON gap). `track_individual` is on by default and cheap (free `athlete_name` field). Confirm: do you want it for v1, and is per-gender (Victor vs Victrix) split needed? If not, leave the toggle off and skip name entry.
- **F4 — Hardening level.** v1 is functionless: RLS + PIN client gate, anon can write to a `live` meet. Acceptable for trusted staff / non-sensitive data. Confirm you're happy with the soft gate, or greenlight the one `manage-meet` edge function to make config + result writes PIN-checked server-side.
- **F5 — Pupil names on a public board.** Spectator shows house totals only by default; if champions are displayed with pupil names on a parent-shared link, confirm that's fine (almost certainly is for sports day).

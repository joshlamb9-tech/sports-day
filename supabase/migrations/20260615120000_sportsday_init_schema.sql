-- ============================================================
-- SPORTS DAY — initial schema (all tables namespaced sportsday_)
-- Shared Caerus project (dlcseuejvducbsjhqvze); coexists with other apps.
-- Applied 2026-06-15.
-- ============================================================

-- 1. Meet (one row per sports day; holds all config) --------------------
create table if not exists sportsday_meets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  event_date    date,
  status        text not null default 'setup',          -- setup | live | finished
  points_scheme jsonb not null default '{"1":5,"2":3,"3":1}'::jsonb,  -- position -> points
  tie_policy    text not null default 'split',          -- split | shared
  track_individual boolean not null default true,
  recorder_pin  text,
  admin_pin     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 2. Houses --------------------------------------------------------------
create table if not exists sportsday_houses (
  id       uuid primary key default gen_random_uuid(),
  meet_id  uuid not null references sportsday_meets(id) on delete cascade,
  name     text not null,
  colour   text not null default '#888888',
  sort     int  not null default 0,
  created_at timestamptz not null default now()
);

-- 3. Age groups / bands (configurable) -----------------------------------
create table if not exists sportsday_age_groups (
  id       uuid primary key default gen_random_uuid(),
  meet_id  uuid not null references sportsday_meets(id) on delete cascade,
  label    text not null,
  sort     int  not null default 0,
  created_at timestamptz not null default now()
);

-- 4. Events --------------------------------------------------------------
create table if not exists sportsday_events (
  id            uuid primary key default gen_random_uuid(),
  meet_id       uuid not null references sportsday_meets(id) on delete cascade,
  name          text not null,
  discipline    text not null default 'track',          -- track | field | relay | other
  age_group_id  uuid references sportsday_age_groups(id) on delete set null,
  category      text not null default 'mixed',          -- boys | girls | mixed
  is_relay      boolean not null default false,
  sort          int  not null default 0,
  status        text not null default 'pending',        -- pending | recording | done
  created_at    timestamptz not null default now()
);

-- 5. Results (one row per placed position; ties allowed) -----------------
create table if not exists sportsday_results (
  id           uuid primary key default gen_random_uuid(),
  meet_id      uuid not null references sportsday_meets(id) on delete cascade,
  event_id     uuid not null references sportsday_events(id) on delete cascade,
  position     int  not null,
  house_id     uuid not null references sportsday_houses(id) on delete cascade,
  athlete_name text,
  recorded_by  text,
  client_uuid  text unique,                             -- idempotency from offline device
  created_at   timestamptz not null default now()
);

create index if not exists sportsday_results_meet_idx     on sportsday_results(meet_id);
create index if not exists sportsday_results_event_idx    on sportsday_results(event_id);
create index if not exists sportsday_houses_meet_idx      on sportsday_houses(meet_id);
create index if not exists sportsday_events_meet_idx      on sportsday_events(meet_id);
create index if not exists sportsday_age_groups_meet_idx  on sportsday_age_groups(meet_id);

create or replace function sportsday_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists sportsday_meets_touch on sportsday_meets;
create trigger sportsday_meets_touch before update on sportsday_meets
  for each row execute function sportsday_touch_updated_at();

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  sportsday_meets, sportsday_houses, sportsday_age_groups, sportsday_events, sportsday_results
  to anon, authenticated;

alter table sportsday_meets      enable row level security;
alter table sportsday_houses     enable row level security;
alter table sportsday_age_groups enable row level security;
alter table sportsday_events     enable row level security;
alter table sportsday_results    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sportsday_meets','sportsday_houses','sportsday_age_groups','sportsday_events','sportsday_results']
  loop
    execute format('drop policy if exists %I_anon_all on %I', t, t);
    execute format('create policy %I_anon_all on %I for all to anon, authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

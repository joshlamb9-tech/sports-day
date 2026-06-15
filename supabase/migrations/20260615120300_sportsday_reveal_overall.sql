-- Admin-controlled big-screen visibility of the overall/house standings.
-- true = standings shown on the Spectator board; false = hidden for "jeopardy"
-- (e.g. black out totals before the final relays). Admin always sees the real numbers.
alter table sportsday_meets
  add column if not exists reveal_overall boolean not null default true;

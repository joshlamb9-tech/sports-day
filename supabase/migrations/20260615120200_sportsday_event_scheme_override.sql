-- Per-event points scheme override (null = use the meet's default scheme).
-- Lets relays score 16/12/8/4 while standard races use 8..1, within one meet.
alter table sportsday_events
  add column if not exists points_scheme jsonb;

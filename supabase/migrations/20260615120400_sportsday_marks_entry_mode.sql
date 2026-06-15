-- Measured field events: an open entrant list ranked by best mark (vs races' fixed finish order).
-- entry_mode 'places' = tap finishing order (default); 'marks' = entrant list ranked by best attempt.
alter table sportsday_events
  add column if not exists entry_mode text not null default 'places';

-- field entrants: attempts is an array of marks (best counts); house may be TBC (null);
-- position is derived from the ranking, so it is no longer required.
alter table sportsday_results
  add column if not exists attempts jsonb;
alter table sportsday_results alter column house_id drop not null;
alter table sportsday_results alter column position drop not null;

-- the imported field events (throws/jumps) become measured-mark events
update sportsday_events set entry_mode = 'marks' where discipline = 'field';

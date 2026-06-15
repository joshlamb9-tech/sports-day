-- Heats for track events: each heat is its own finish-order race; points awarded
-- per heat and summed. 'heat' is a letter (A/B/C…) for race results, NULL for
-- measured field entrants. Recording replaces results per (event, heat).
alter table sportsday_results add column if not exists heat text;

-- Backfill existing race (non-marks) results to heat 'A' so per-heat replace is consistent.
update sportsday_results r set heat = 'A'
  from sportsday_events e
  where r.event_id = e.id and coalesce(e.entry_mode, 'places') <> 'marks' and r.heat is null;

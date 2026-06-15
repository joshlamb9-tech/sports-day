-- Non-destructive corrections: void a wrong/duplicate result instead of deleting it.
-- Totals sum only voided=false rows; the Admin "void" action sets this true.
-- (Applied to Caerus project dlcseuejvducbsjhqvze on 2026-06-15.)
alter table sportsday_results
  add column if not exists voided boolean not null default false;

create index if not exists sportsday_results_live_idx
  on sportsday_results (meet_id, event_id) where voided = false;

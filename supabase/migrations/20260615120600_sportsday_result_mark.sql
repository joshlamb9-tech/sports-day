-- Optional single measurement on a result row: used for TRACK times (seconds).
-- Field events keep using `attempts` (distance/height, best counts). Never required;
-- does not affect scoring (finish order / best mark still decides placing).
alter table sportsday_results add column if not exists mark numeric;

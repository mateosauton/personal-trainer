-- The full catalog (instructions, tips, muscle lists, media refs) ships inside
-- the app as lib/data/exercises.json: the plan generator runs on-device and
-- must work with no network, so Postgres holding a second copy would only
-- create drift. Keep here just what makes exercise_id a real foreign key and
-- lets server-side queries read back a human name.
alter table exercises
  drop column mechanic,
  drop column force_type,
  drop column met,
  drop column primary_muscles,
  drop column secondary_muscles,
  drop column instructions,
  drop column tips,
  drop column media_refs;

comment on table exercises is
  'Slim mirror of lib/data/exercises.json. Rebuild both with scripts/build-catalog.mjs.';
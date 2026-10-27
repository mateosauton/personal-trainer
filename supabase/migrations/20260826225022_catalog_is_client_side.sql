-- The exercise catalog is static reference data versioned with the app binary
-- (lib/data/exercises.json, built by scripts/build-catalog.mjs). Mirroring 889
-- rows into Postgres bought nothing: every read happens in the client, which
-- already holds the catalog, and a server copy could only drift from the
-- bundled one. Drop it and keep exercise_id as a plain catalog key.
alter table plan_items drop constraint plan_items_exercise_id_fkey;
alter table set_logs drop constraint set_logs_exercise_id_fkey;
alter table exercise_progress drop constraint exercise_progress_exercise_id_fkey;

drop table exercises;
drop type media_kind;
drop type media_source;

comment on column plan_items.exercise_id is
  'Key into lib/data/exercises.json (app-bundled catalog), not a foreign key.';
comment on column set_logs.exercise_id is
  'Key into lib/data/exercises.json (app-bundled catalog), not a foreign key.';
comment on column exercise_progress.exercise_id is
  'Key into lib/data/exercises.json (app-bundled catalog), not a foreign key.';
-- Owner IDs alone do not protect references: foreign keys are validated even
-- when the referenced row is invisible through RLS. Check the full parent path.
-- Existing records remain readable/deletable by their owner; no data is changed.
alter policy sessions_rw on public.sessions
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.plan_days d
      join public.plans p on p.id = d.plan_id
      where d.id = sessions.plan_day_id and p.user_id = auth.uid()
    )
  );

alter policy set_logs_rw on public.set_logs
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = set_logs.session_id and s.user_id = auth.uid()
        and (
          -- A deleted plan item leaves a historic log's reference null.
          set_logs.plan_item_id is null
          or exists (
            select 1 from public.plan_items i
            join public.plan_blocks b on b.id = i.block_id
            join public.plan_days d on d.id = b.plan_day_id
            join public.plans p on p.id = d.plan_id
            where i.id = set_logs.plan_item_id
              and i.exercise_id = set_logs.exercise_id
              and d.id = s.plan_day_id
              and p.user_id = auth.uid()
          )
        )
    )
  );

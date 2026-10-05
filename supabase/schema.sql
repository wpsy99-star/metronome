-- No-login shared score library: everyone with the public site can read/change/delete scores.
-- Run in Supabase SQL Editor. For private libraries, authentication and owner-based policies are required.
create table if not exists public.measure_scores (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  abc text not null check (char_length(abc) between 1 and 500000),
  bpm integer not null default 100 check (bpm between 30 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.measure_scores enable row level security;
grant usage on schema public to anon;
grant select, insert, update, delete on public.measure_scores to anon;
create index if not exists measure_scores_created_at_idx on public.measure_scores(created_at desc, id desc);
create or replace function public.measure_scores_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create or replace trigger measure_scores_updated_at before update on public.measure_scores
for each row execute function public.measure_scores_touch_updated_at();
drop policy if exists measure_scores_public_select on public.measure_scores;
create policy measure_scores_public_select on public.measure_scores for select to anon using (true);
drop policy if exists measure_scores_public_insert on public.measure_scores;
create policy measure_scores_public_insert on public.measure_scores for insert to anon with check (true);
drop policy if exists measure_scores_public_update on public.measure_scores;
create policy measure_scores_public_update on public.measure_scores for update to anon using (true) with check (true);
drop policy if exists measure_scores_public_delete on public.measure_scores;
create policy measure_scores_public_delete on public.measure_scores for delete to anon using (true);

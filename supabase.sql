-- Swing Lab · tabla del ranking en línea (pégalo en Supabase → SQL Editor → Run)
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  player text not null check (char_length(player) between 2 and 24),
  pid text not null check (char_length(pid) between 8 and 64),
  kind text not null check (kind in ('round','drive','speed','prox')),
  course text not null default '',
  sel text not null default '',
  value real not null,
  par_diff int,
  src text,
  club text,
  app text
);
alter table public.scores enable row level security;
-- cualquiera puede leer el ranking y agregar puntajes razonables; nadie puede editar ni borrar
create policy "leer" on public.scores for select to anon using (true);
create policy "agregar" on public.scores for insert to anon with check (
  (kind='round' and value between 3 and 200) or
  (kind='drive' and value between 30 and 420) or
  (kind='speed' and value between 10 and 75) or
  (kind='prox'  and value between 0 and 150)
);
create index if not exists scores_rank_idx on public.scores (kind, course, sel, value);

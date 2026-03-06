create table public.discovery_stats (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  dig_date date not null default current_date,
  artists_discovered int not null default 0,
  tracks_discovered int not null default 0,
  playlists_created int not null default 0,
  genres_found text[] not null default '{}',
  streak int not null default 1,
  created_at timestamptz default now(),
  unique(email, dig_date)
);

create index idx_discovery_stats_email on public.discovery_stats(email);
create index idx_discovery_stats_date on public.discovery_stats(dig_date desc);

-- RLS
alter table public.discovery_stats enable row level security;
create policy "anon_select_discovery_stats" on public.discovery_stats for select to anon using (true);
create policy "anon_insert_discovery_stats" on public.discovery_stats for insert to anon with check (true);
create policy "anon_update_discovery_stats" on public.discovery_stats for update to anon using (true);

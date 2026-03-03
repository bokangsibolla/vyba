-- Profiles table
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  timezone text default 'UTC',
  issue_number int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Music service connections
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  service text check (service in ('spotify', 'deezer')) not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  service_user_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, service)
);

-- Daily issues (cached per user per day)
create table public.daily_issues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  issue_number int not null,
  sections jsonb not null default '[]',
  dj_intro text not null default '',
  dj_teaser text not null default '',
  created_at timestamptz default now(),
  unique(user_id, issue_number)
);

-- Indexes
create index idx_connections_user on public.connections(user_id);
create index idx_daily_issues_user on public.daily_issues(user_id);
create index idx_daily_issues_date on public.daily_issues(created_at);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.connections enable row level security;
alter table public.daily_issues enable row level security;

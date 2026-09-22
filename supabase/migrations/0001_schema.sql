-- METRON · schema and security (run once in the Supabase SQL editor, or via `supabase db push`)
-- Every market figure is stored with its source, timestamp and status. Nothing is fabricated:
-- if a provider returns nothing, no row is written and the front-end shows UNAVAILABLE.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- MARKET DATA (written only by the refresh function with the service role)
-- ---------------------------------------------------------------------------
create table if not exists instruments (
  sym text primary key,                       -- METRON symbol, e.g. US10Y, BRENT, ADX
  name text not null,
  asset_class text not null check (asset_class in ('EQUITIES','RATES','FX','COMMODITIES','CRYPTO','CREDIT','VOLATILITY')),
  region text not null,                       -- US, EUROPE, UK, JAPAN, CHINA, ASIA, GCC, UAE, SAUDI, GLOBAL
  currency text not null default 'USD',
  calendar text not null default 'us' check (calendar in ('us','eu','asia','gcc','sunthu','crypto')),
  unit text not null default '',              -- '$', '%', ''
  provider text,                              -- treasury | fred | twelvedata | exchange | none
  provider_symbol text,                       -- provider-side id (FRED series id, Twelve Data symbol…)
  tape_order int,                             -- position on the tape; null = not on tape
  active boolean not null default true
);

create table if not exists observations (
  id bigserial primary key,
  sym text not null references instruments(sym) on delete cascade,
  at date not null,                           -- market date the value belongs to
  value numeric,
  chg_pct numeric,
  chg_bp numeric,
  wk numeric,
  source text not null,                       -- source id (UST, FRED, TD, …)
  source_url text,
  status text not null check (status in ('LIVE','DELAYED','EOD','STALE','UNAVAILABLE')),
  note text,
  fetched_at timestamptz not null default now(),
  unique (sym, at, source)
);
create index if not exists observations_sym_at on observations (sym, at desc);

create table if not exists series_daily (                 -- daily history for charts and correlations
  sym text not null references instruments(sym) on delete cascade,
  at date not null,
  value numeric not null,
  source text not null,
  primary key (sym, at)
);

create table if not exists curves (                       -- full par yield curve per day
  id bigserial primary key,
  at date not null,
  tenors jsonb not null,                                  -- ["1M","2M",…,"30Y"]
  yields jsonb not null,                                  -- [4.31, …]
  source text not null default 'UST',
  source_url text,
  fetched_at timestamptz not null default now(),
  unique (at, source)
);

create table if not exists wire_items (
  id bigserial primary key,
  published_at timestamptz not null,
  source text not null,                                   -- FED, ECB, BOE, BOJ, UST, CNBC…
  source_url text not null unique,
  region text,
  asset_class text,
  importance text not null default 'MEDIUM' check (importance in ('MARKET_MOVING','HIGH','MEDIUM','LOW')),
  headline text not null,
  context text,
  fetched_at timestamptz not null default now()
);
create index if not exists wire_items_published on wire_items (published_at desc);

create table if not exists calendar_events (
  id bigserial primary key,
  when_at timestamptz,
  when_text text,                                         -- "week of 2026-09-21" when no exact time
  region text not null,
  event text not null,
  period text,
  actual text, consensus text, previous text,             -- text: consensus stays null (UNAVAILABLE) unless licensed
  importance text not null default 'MEDIUM' check (importance in ('MARKET_MOVING','HIGH','MEDIUM','LOW')),
  status text not null default 'SCHEDULED',
  assets jsonb not null default '[]',
  source text, source_url text,
  fetched_at timestamptz not null default now(),
  unique (event, region, when_at)
);

create table if not exists central_banks (
  code text primary key,                                  -- FED, ECB, BOE, BOJ, CBUAE, SAMA
  name text not null,
  rate text,                                              -- "3.75–4.00%" (text keeps ranges honest)
  last_move text,
  next_meeting text,
  tone text check (tone in ('HAWKISH','DOVISH','NEUTRAL','UNAVAILABLE')),
  evidence text,
  source text, source_url text,
  updated_at timestamptz not null default now()
);

create table if not exists providers (
  id text primary key,                                    -- treasury, fred, twelvedata, rss:fed …
  name text not null,
  domain text not null,
  status text not null default 'NOT CONNECTED',           -- CONNECTED · NOT CONNECTED · KEY MISSING · ERROR
  config jsonb not null default '{}',                     -- feed urls, symbol lists (no secrets)
  last_ok timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists snapshots (                    -- the assembled JSON the front-end consumes
  id bigserial primary key,
  fetched_at timestamptz not null default now(),
  market_date date,
  body jsonb not null,
  summary jsonb not null default '{}'                     -- counts, failures, durations
);
create index if not exists snapshots_fetched on snapshots (fetched_at desc);

create table if not exists briefs (
  id bigserial primary key,
  edition text not null check (edition in ('MORNING','AFTERNOON','EVENING','WEEKLY')),
  for_date date not null,
  mode text not null check (mode in ('PRO','CLEAR','30-SEC')),
  body jsonb not null,
  model text,
  generated_at timestamptz not null default now(),
  unique (edition, for_date, mode)
);

-- ---------------------------------------------------------------------------
-- USERS (invite-only; first user becomes OWNER)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  role text not null default 'MEMBER' check (role in ('OWNER','MEMBER')),
  timezone text not null default 'Asia/Dubai',
  reading_mode text not null default 'PRO' check (reading_mode in ('PRO','CLEAR','30-SEC')),
  regions jsonb not null default '["GLOBAL","US","GCC","UAE"]',
  brief_time text not null default '07:30',
  notifications jsonb not null default '{"brief":true,"moves":true,"cb":true,"learn":true}',
  created_at timestamptz not null default now()
);

create table if not exists watchlists (
  user_id uuid not null references profiles(id) on delete cascade,
  sym text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, sym)
);

create table if not exists holdings (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  sym text not null,
  weight numeric not null check (weight >= 0 and weight <= 100),
  added_at timestamptz not null default now()
);

create table if not exists paper_positions (              -- SIMULATION only, never real orders
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  sym text not null, side text not null check (side in ('LONG','SHORT')),
  size numeric not null default 1, entry numeric not null, stop numeric not null, target numeric not null,
  rr numeric, thesis text, catalyst text, invalidation text,
  opened_at timestamptz not null default now(), closed_at timestamptz, result text
);

create table if not exists journal_entries (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  position_id bigint references paper_positions(id) on delete set null,
  sym text, side text, thesis text, catalyst text, invalidation text, result text,
  lesson_id text, notes text,
  created_at timestamptz not null default now()
);

create table if not exists learning_progress (
  user_id uuid not null references profiles(id) on delete cascade,
  lesson_id text not null,
  stage text not null default 'INTRODUCED' check (stage in ('INTRODUCED','LEARNING','UNDERSTOOD','MASTERED')),
  answer int, done_at date, recalls int not null default 0, next_due date, mastered boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table if not exists ask_log (
  id bigserial primary key,
  user_id uuid references profiles(id) on delete cascade,
  question text not null, context jsonb, answer jsonb, model text,
  created_at timestamptz not null default now()
);

-- First confirmed user becomes OWNER, everyone invited afterwards is MEMBER.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
          case when (select count(*) from public.profiles) = 0 then 'OWNER' else 'MEMBER' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table instruments enable row level security;
alter table observations enable row level security;
alter table series_daily enable row level security;
alter table curves enable row level security;
alter table wire_items enable row level security;
alter table calendar_events enable row level security;
alter table central_banks enable row level security;
alter table providers enable row level security;
alter table snapshots enable row level security;
alter table briefs enable row level security;
alter table profiles enable row level security;
alter table watchlists enable row level security;
alter table holdings enable row level security;
alter table paper_positions enable row level security;
alter table journal_entries enable row level security;
alter table learning_progress enable row level security;
alter table ask_log enable row level security;

-- Market data: any signed-in member may read; only the service role (refresh function) writes.
do $$ declare t text; begin
  foreach t in array array['instruments','observations','series_daily','curves','wire_items','calendar_events','central_banks','providers','snapshots','briefs'] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

-- Profiles: own row; OWNER reads every profile.
drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_owner_read on profiles;
create policy profiles_owner_read on profiles for select to authenticated using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'OWNER'));

-- Personal tables: own rows only.
do $$ declare t text; begin
  foreach t in array array['watchlists','holdings','paper_positions','journal_entries','learning_progress','ask_log'] loop
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format('create policy %I on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_own', t);
  end loop;
end $$;

-- Convenience view: latest observation per instrument
create or replace view latest_observations as
select distinct on (o.sym) o.*, i.name, i.asset_class, i.region, i.currency, i.calendar, i.unit, i.tape_order
from observations o join instruments i on i.sym = o.sym
where i.active
order by o.sym, o.at desc, o.fetched_at desc;
grant select on latest_observations to authenticated;

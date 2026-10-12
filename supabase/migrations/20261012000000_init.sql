-- DopaDam sync schema. Each device keeps the full data locally; Supabase only holds a copy so a
-- user's devices see each other's data. Times are epoch milliseconds (bigint) as on the devices.
--
-- Every row belongs to one user (user_id = auth.uid(), enforced by Row Level Security).
-- updated_at is the device clock at the change ("newest wins"); server_updated_at is set here and
-- is what devices use as their pull cursor.

create table public.devices (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  platform text not null check (platform in ('android', 'windows', 'extension')),
  name text not null default '',
  version text not null default '',
  last_seen bigint not null,
  updated_at bigint not null,
  schema_version int not null default 1,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.tag_rules (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('app', 'exe', 'domain', 'allow_url')),
  pattern text not null,
  tag text not null check (tag in ('entertainment', 'game', 'work', 'study', 'communication', 'utility', 'ignore')),
  delay_seconds int check (delay_seconds between 0 and 120),
  updated_at bigint not null,
  deleted boolean not null default false,
  schema_version int not null default 1,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null default 'settings',
  json jsonb not null,
  updated_at bigint not null,
  schema_version int not null default 1,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Append only: a device pushes an event once it has a decision.
create table public.intercept_events (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  device_id text not null,
  object text not null,
  tag text not null,
  level int not null check (level between 0 and 3),
  lock_seconds int not null,
  n int not null,
  shown_at bigint not null,
  study_label text,
  decision text check (decision in ('enter', 'exit', 'alternative')),
  decided_at bigint,
  allow_minutes int,
  activity text,
  activity_minutes int,
  schema_version int not null default 1,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- One row per day, device and tag; only the owning device writes it.
create table public.usage_daily (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  day text not null,
  device_id text not null,
  tag text not null,
  seconds double precision not null check (seconds >= 0),
  updated_at bigint not null,
  schema_version int not null default 1,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.study_rules (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  days text not null,
  start text not null,
  "end" text not null,
  label text,
  exceptions text not null default '',
  updated_at bigint not null,
  deleted boolean not null default false,
  schema_version int not null default 1,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.study_sessions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  source text not null check (source in ('manual', 'rule', 'taskflow')),
  start bigint not null,
  "end" bigint not null,
  label text,
  external_id text,
  updated_at bigint not null,
  deleted boolean not null default false,
  schema_version int not null default 1,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Newest wins: an update carrying an older updated_at than the stored row is skipped.
create function public.keep_newest() returns trigger
language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

-- Events are append only: once stored, a later push of the same event changes nothing.
create function public.events_append_only() returns trigger
language plpgsql as $$
begin
  return null;
end;
$$;

create function public.stamp_insert() returns trigger
language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['devices', 'tag_rules', 'settings', 'usage_daily', 'study_rules', 'study_sessions'] loop
    execute format('create trigger keep_newest before update on public.%I for each row execute function public.keep_newest()', t);
  end loop;
  foreach t in array array['devices', 'tag_rules', 'settings', 'intercept_events', 'usage_daily', 'study_rules', 'study_sessions'] loop
    execute format('create trigger stamp_insert before insert on public.%I for each row execute function public.stamp_insert()', t);
    execute format('create index %I on public.%I (user_id, server_updated_at)', t || '_pull', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

create trigger append_only before update on public.intercept_events
  for each row execute function public.events_append_only();

-- "Xóa toàn bộ dữ liệu" (spec 10, privacy): removes every row of the calling user.
create function public.delete_my_data() returns void
language sql security invoker as $$
  delete from public.devices where user_id = auth.uid();
  delete from public.tag_rules where user_id = auth.uid();
  delete from public.settings where user_id = auth.uid();
  delete from public.intercept_events where user_id = auth.uid();
  delete from public.usage_daily where user_id = auth.uid();
  delete from public.study_rules where user_id = auth.uid();
  delete from public.study_sessions where user_id = auth.uid();
$$;

revoke all on function public.delete_my_data() from anon, public;
grant execute on function public.delete_my_data() to authenticated;

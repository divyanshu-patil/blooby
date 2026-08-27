-- ---------------------------------------------------------------------------
-- Stage 4: roles, cloud projects (S3-backed), unified asset library, splashscreens
--
-- One `assets` table backs presets AND expressions, for every source (builtin /
-- official / user / community). Source + status + owner decide what a row means and
-- who may see it; there is deliberately no separate table per source, so one set of
-- policies, indexes and services covers all four.
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('user', 'admin');

alter table public.profiles
  add column role public.user_role not null default 'user',
  add column username text unique,
  add column avatar_url text,
  add column updated_at timestamptz not null default now(),
  add column last_login_at timestamptz;

update public.profiles set role = 'admin' where is_admin = true;
alter table public.profiles drop column is_admin;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Admin lookups appear inside policies on profiles itself, so a plain subquery would
-- recurse. A SECURITY DEFINER helper in a private schema breaks the cycle; it is not
-- callable over RPC because execute is revoked from every client role.
create schema if not exists private;

create function private.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function private.is_admin() from public, anon, authenticated;

create policy "profiles: admins can read every profile"
  on public.profiles for select
  to authenticated
  using ((select private.is_admin()));

create policy "profiles: a user can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- projects: metadata only. The animation JSON lives in S3; this row points at it.
-- ---------------------------------------------------------------------------
create type public.visibility as enum ('private', 'public');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  thumbnail_url text,
  s3_key text not null,
  s3_bucket text not null,
  current_version integer not null default 1 check (current_version > 0),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  checksum text,
  visibility public.visibility not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz
);

create index projects_user_updated_idx on public.projects(user_id, updated_at desc);
create index projects_created_at_idx on public.projects(created_at);
create index projects_public_idx on public.projects(updated_at desc) where visibility = 'public';

alter table public.projects enable row level security;

create policy "projects: owner has full access"
  on public.projects for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "projects: public projects are readable by anyone"
  on public.projects for select
  to anon, authenticated
  using (visibility = 'public');

create policy "projects: admins can read metadata"
  on public.projects for select
  to authenticated
  using ((select private.is_admin()));

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- assets: presets and expressions, every source, one table.
-- ---------------------------------------------------------------------------
create type public.asset_kind as enum ('preset', 'expression');
create type public.asset_source as enum ('builtin', 'official', 'user', 'community');
create type public.asset_status as enum ('draft', 'pending_review', 'published', 'rejected', 'archived');

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  kind public.asset_kind not null,
  source public.asset_source not null,
  status public.asset_status not null default 'draft',
  owner_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 2000),
  category text,
  tags text[] not null default '{}',
  thumbnail_url text,
  data jsonb not null,
  schema_version integer not null default 1,
  version integer not null default 1,
  download_count integer not null default 0 check (download_count >= 0),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assets_browse_idx on public.assets(kind, source, published_at desc) where status = 'published';
create index assets_owner_idx on public.assets(owner_id, updated_at desc);
create index assets_moderation_idx on public.assets(status, created_at) where status in ('pending_review', 'rejected');
create index assets_tags_idx on public.assets using gin(tags);

alter table public.assets enable row level security;

create policy "assets: published content is public"
  on public.assets for select
  to anon, authenticated
  using (status = 'published');

create policy "assets: owner has full access to their own"
  on public.assets for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "assets: admins can read everything"
  on public.assets for select
  to authenticated
  using ((select private.is_admin()));

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- splashscreens: admin-controlled, exactly one live at a time.
-- ---------------------------------------------------------------------------
create type public.splash_status as enum ('draft', 'published', 'archived');

create table public.splashscreens (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  status public.splash_status not null default 'draft',
  data jsonb not null,
  background text not null default '#0b0b0f',
  duration_ms integer not null default 2000 check (duration_ms between 200 and 15000),
  fade_ms integer not null default 400 check (fade_ms between 0 and 5000),
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- the invariant the whole feature rests on: at most one published splashscreen
create unique index splashscreens_one_published_idx on public.splashscreens((status)) where status = 'published';

alter table public.splashscreens enable row level security;

create policy "splashscreens: the published one is readable by anyone"
  on public.splashscreens for select
  to anon, authenticated
  using (status = 'published');

create policy "splashscreens: admins can read all"
  on public.splashscreens for select
  to authenticated
  using ((select private.is_admin()));

create trigger splashscreens_set_updated_at
  before update on public.splashscreens
  for each row execute function public.set_updated_at();

-- handle_new_user now seeds the profile fields the app actually reads
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

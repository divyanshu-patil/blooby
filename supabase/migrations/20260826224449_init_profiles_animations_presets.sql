-- profiles: one row per auth.users row, synced by trigger. Only this table answers
-- "is this caller an admin" -- never derived from a JWT claim a user could edit.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: a user can read their own row"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

-- no insert/update/delete policy for authenticated/anon on purpose: rows are created only
-- by the trigger below (as the trigger's definer), and is_admin is only ever flipped by
-- the service-role key from apps/api -- never something the row's own owner can self-grant.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- shared updated_at trigger, reused by both tables below
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- animations: a user's saved projects. Fully private -- only the owner can see or touch
-- their own rows, enforced the same way on every verb (select/insert/update/delete).
create table public.animations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  project_json jsonb not null,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index animations_user_id_idx on public.animations(user_id);

alter table public.animations enable row level security;

create policy "animations: owner can read their own"
  on public.animations for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "animations: owner can insert their own"
  on public.animations for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "animations: owner can update their own"
  on public.animations for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "animations: owner can delete their own"
  on public.animations for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create trigger animations_set_updated_at
  before update on public.animations
  for each row execute function public.set_updated_at();

-- presets: the curated global library. Publicly readable once published (anon included --
-- apps/web reads this straight from Supabase with the publishable key, no API hop); writes
-- only ever happen through apps/api's service-role client, which bypasses RLS entirely, so
-- deliberately no insert/update/delete policy exists for anon/authenticated at all.
create table public.presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  source text,
  preset_json jsonb not null,
  thumbnail_url text,
  published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index presets_published_idx on public.presets(published) where published = true;

alter table public.presets enable row level security;

create policy "presets: anyone can read published presets"
  on public.presets for select
  to anon, authenticated
  using (published = true);

create trigger presets_set_updated_at
  before update on public.presets
  for each row execute function public.set_updated_at();

-- thumbnails bucket: public-read (thumbnails are meant to be shown), writes scoped to a
-- path prefixed with the uploader's own uid so one user can never overwrite another's file.
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

create policy "thumbnails: public read"
  on storage.objects for select
  to public
  using (bucket_id = 'thumbnails');

create policy "thumbnails: owner can upload into their own prefix"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "thumbnails: owner can replace their own files"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "thumbnails: owner can delete their own files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = (select auth.uid())::text);

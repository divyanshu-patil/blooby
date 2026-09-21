-- Web analytics: which pages people open, and how they move between them.
--
-- Everything else in the admin panel is derived from timestamps on rows that exist anyway
-- (see services/analytics.service.ts). "Which page was visited" is the first question
-- timestamps genuinely cannot answer — nothing writes a row when someone opens the
-- community tab — so this is the one event table in the app.
--
-- COOKIELESS, deliberately. There is no identifier stored on the visitor's device and
-- nothing here can be traced back to a person after the fact: `visitor` is a hash of the
-- address, the user agent and a salt that ROTATES DAILY, so it distinguishes two people on
-- the same day and cannot link the same person across two days. The raw address is never
-- written. A signed-in visit also records user_id, because an admin asking "what do our
-- users do" is a different question from "how much traffic is there".
create table public.page_views (
  id        bigint      generated always as identity primary key,
  -- the route, already normalised by the client: '/projects/:id', never the real id.
  -- A path with an id in it would make every project its own row in "top pages" and
  -- would put private ids in an analytics table for no benefit.
  path      text        not null,
  -- 'web' or 'admin' — the same paths exist in both and mean different things
  app       text        not null default 'web',
  -- where they came FROM inside the app, for the navigation flow. Null on a first landing.
  from_path text,
  -- the external referrer's host only ('google.com'), never the full URL with its query
  referrer  text,
  user_id   uuid        references auth.users (id) on delete set null,
  visitor   text        not null,
  device    text,
  country   text,
  at        timestamptz not null default now()
);

-- every query is "the last N days", then grouped
create index page_views_at_idx on public.page_views (at desc);
create index page_views_path_idx on public.page_views (path, at desc);
create index page_views_visitor_idx on public.page_views (visitor, at desc);

alter table public.page_views enable row level security;

comment on table public.page_views is
  'Cookieless page analytics. `visitor` is a daily-rotating salted hash, not an identifier: '
  'it cannot be linked across days and no address is stored. Service role only — no RLS policies by design.';

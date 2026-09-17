-- Community projects: who may edit a public project, and the counts trending ranks by.
--
-- `access` only means something while a project is public: 'view' lets anyone open and
-- duplicate it, 'edit' also lets any signed-in user save to it. Writes go through the API
-- (which checks this column), so no new RLS policy grants strangers an update.
create type public.project_access as enum ('view', 'edit');

alter table public.projects
  add column access public.project_access not null default 'view',
  add column view_count integer not null default 0 check (view_count >= 0),
  add column duplicate_count integer not null default 0 check (duplicate_count >= 0);

-- the community list reads public projects newest first, or by trending (score over the
-- same rows); the existing partial index on updated_at covers both scans

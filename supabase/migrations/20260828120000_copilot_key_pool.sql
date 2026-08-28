-- Copilot key pool, managed from the admin dashboard.
--
-- Until now the only Ollama Cloud keys the server could use came from OLLAMA_KEYS in the
-- environment, which means changing them is a redeploy and only whoever owns the host can
-- do it. These two tables move that to the dashboard, and add the switch that decides
-- whether users may bring their own keys at all.

-- One row, forever. `id` is a boolean primary key with a check that it is true, which is
-- the cheapest way to make "there is exactly one settings row" a constraint Postgres
-- enforces rather than a convention the service remembers.
create table public.copilot_settings (
  id              boolean     primary key default true,
  allow_user_keys boolean     not null default true,
  updated_at      timestamptz not null default now(),
  constraint copilot_settings_singleton check (id)
);

insert into public.copilot_settings (id) values (true);

create table public.copilot_keys (
  id           uuid        primary key default gen_random_uuid(),
  label        text        not null default '',
  -- the key itself. It never leaves the server: every read path selects `hint` instead.
  secret       text        not null,
  -- masked form, safe to show an admin so they can tell two keys apart
  hint         text        not null,
  status       text        not null default 'ok',
  note         text,
  last_used_at timestamptz,
  created_by   uuid        references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint copilot_keys_status_check check (status in ('ok', 'rate-limited', 'error'))
);

-- Healthy keys first, then the ones that have been resting longest — this is exactly the
-- order the rotation reads them in, so it is an index rather than a sort.
create index copilot_keys_rotation_idx on public.copilot_keys (status, last_used_at nulls first);

-- RLS on, and deliberately NO policies on either table.
--
-- That is not an oversight: a table with RLS enabled and no policy is readable only by
-- the service role, which means only apps/api, which means only behind `requireAdmin`.
-- An anon or authenticated key — including one leaked out of a browser bundle — cannot
-- read a single row. Users reach the pool through POST /api/copilot/chat, which uses the
-- keys without ever returning them, and see nothing but `allowUserKeys` and whether any
-- key exists at all.
alter table public.copilot_settings enable row level security;
alter table public.copilot_keys enable row level security;

comment on table public.copilot_keys is
  'Ollama Cloud API keys for the copilot proxy. Service role only — no RLS policies by design.';
comment on column public.copilot_keys.secret is
  'Plaintext API key. Never selected by any read path that reaches a client; use `hint`.';

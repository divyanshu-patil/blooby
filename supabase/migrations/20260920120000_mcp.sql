-- The MCP server: AI clients (Claude, ChatGPT, Cursor…) acting on a person's projects.
--
-- Three tables, all service-role only (RLS on, no policies — the same pattern as
-- copilot_keys): nothing here is ever read with a browser key. apps/api is the only reader.

-- OAuth clients, registered dynamically (RFC 7591) by the AI app itself when a person adds
-- Blooby as a connector. Public clients have no secret; confidential ones store only a hash.
create table public.mcp_clients (
  client_id          text        primary key,
  client_secret_hash text,
  client_name        text        not null default 'AI client',
  redirect_uris      text[]      not null default '{}',
  metadata           jsonb       not null default '{}',
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz
);

-- Every credential an AI client can hold, and the short-lived steps that mint them:
--   request  an /authorize call waiting for the person to approve it (id is the handle)
--   code     an authorization code, single use, ten minutes
--   access   a bearer token for /mcp, one hour
--   refresh  swaps for a new access token (and is itself rotated on use)
--   pat      a personal access token made by hand in the editor's MCP tab
-- Secrets are stored ONLY as sha256 hashes — a database dump holds no usable token.
-- `grant_id` ties an authorization's code, access and refresh tokens together, so
-- disconnecting a client revokes every one of them at once.
create table public.mcp_tokens (
  id             uuid        primary key default gen_random_uuid(),
  kind           text        not null,
  token_hash     text        unique,
  user_id        uuid        references auth.users (id) on delete cascade,
  client_id      text        references public.mcp_clients (client_id) on delete cascade,
  grant_id       uuid,
  name           text        not null default '',
  scopes         text[]      not null default '{}',
  -- read_only: inspect only · suggest: every change waits for approval in the editor · full
  mode           text        not null default 'full',
  resource       text,
  redirect_uri   text,
  code_challenge text,
  params         jsonb,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  last_used_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint mcp_tokens_kind_check check (kind in ('request', 'code', 'access', 'refresh', 'pat')),
  constraint mcp_tokens_mode_check check (mode in ('read_only', 'suggest', 'full'))
);

create index mcp_tokens_user_idx on public.mcp_tokens (user_id, kind, created_at desc);
create index mcp_tokens_grant_idx on public.mcp_tokens (grant_id);

-- What AI clients did, for the person (the editor's MCP tab) and for security review.
-- Operation names and ids only — never arguments, tokens or project content.
create table public.mcp_audit (
  id          bigint      generated always as identity primary key,
  user_id     uuid        references auth.users (id) on delete cascade,
  client_id   text,
  token_id    uuid,
  operation   text        not null,
  project_id  uuid,
  ok          boolean     not null,
  error_code  text,
  request_id  text,
  run_id      text,
  duration_ms integer,
  created_at  timestamptz not null default now()
);

create index mcp_audit_user_idx on public.mcp_audit (user_id, created_at desc);
create index mcp_audit_project_idx on public.mcp_audit (project_id, created_at desc);

alter table public.mcp_clients enable row level security;
alter table public.mcp_tokens enable row level security;
alter table public.mcp_audit enable row level security;

comment on table public.mcp_tokens is
  'MCP OAuth + personal access tokens. Hashes only. Service role only — no RLS policies by design.';

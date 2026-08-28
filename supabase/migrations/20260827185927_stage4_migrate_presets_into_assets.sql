-- The old `presets` table is superseded by `assets` (which also covers expressions and
-- the community/official sources). Carry the seeded builtins across.
-- The legacy `presets` and `animations` tables are intentionally left in place here;
-- dropping them is a separate, deliberate step.
insert into public.assets (kind, source, status, name, category, data, published_at)
select
  'preset'::public.asset_kind,
  'builtin'::public.asset_source,
  'published'::public.asset_status,
  name,
  category,
  preset_json,
  created_at
from public.presets;

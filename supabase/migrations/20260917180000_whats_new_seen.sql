-- What's New: the newest release a person has closed the panel on. Everything newer is shown
-- to them, in the editor and on the dashboard. Written only through the API.
alter table public.profiles add column last_seen_release text check (last_seen_release is null or char_length(last_seen_release) <= 32);

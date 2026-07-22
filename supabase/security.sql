-- Row-level security posture: deny-all for client keys.
--
-- All data access goes through the Next.js API routes, which use the
-- service_role key (bypasses RLS). The publishable/anon key that ships
-- in the browser bundle gets no table access at all.
alter table documents enable row level security;
alter table query_cache enable row level security;

-- Belt and braces: revoke default grants so a future permissive policy
-- can't accidentally re-expose the tables to client roles.
revoke all on table documents from anon, authenticated;
revoke all on table query_cache from anon, authenticated;

-- Prevent clients from invoking the RPCs directly with the anon key.
revoke execute on function match_documents(vector, float, int) from anon, authenticated;
revoke execute on function match_cached_query(vector, float) from anon, authenticated;

-- Hardening (Supabase linter 0011 / 0014): pin function search_path and
-- keep pgvector out of the public schema.
alter function public.match_documents(vector, float, int)
  set search_path = public, extensions;
alter function public.match_cached_query(vector, float)
  set search_path = public, extensions;
alter extension vector set schema extensions;

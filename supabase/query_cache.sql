-- Query answer cache: stores previously generated answers so repeated
-- questions don't spend OpenAI tokens again.
create table if not exists query_cache (
  id bigserial primary key,
  query text not null,
  normalized_query text not null unique,
  embedding vector(1536) not null,
  answer text not null,
  sources jsonb,
  created_at timestamptz not null default now()
);

create index if not exists query_cache_normalized_idx
  on query_cache (normalized_query);

-- Finds the single most similar previously-asked question above the
-- threshold (use a high threshold like 0.97 so only near-identical
-- questions reuse an answer).
create or replace function match_cached_query (
  query_embedding vector(1536),
  match_threshold float
)
returns table (
  id bigint,
  answer text,
  sources jsonb,
  similarity float
)
language sql stable
as $$
  select
    query_cache.id,
    query_cache.answer,
    query_cache.sources,
    1 - (query_cache.embedding <=> query_embedding) as similarity
  from query_cache
  where 1 - (query_cache.embedding <=> query_embedding) > match_threshold
  order by query_cache.embedding <=> query_embedding
  limit 1;
$$;

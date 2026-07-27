# RAG Search App

A **Retrieval-Augmented Generation (RAG)** application built with **Next.js**, **Supabase (pgvector)**, and **OpenAI**. Upload your documents and ask questions about them in natural language — answers are generated from the actual content of your files, with source citations.

## Features

- Upload PDF, DOCX, and TXT documents (up to 10 MB)
- Semantic search over document content using vector embeddings
- AI-generated answers grounded in your documents, with source chunks shown
- **Two-layer answer cache** — repeated questions cost zero (or near-zero) OpenAI tokens
- Per-IP rate limiting on search to protect your OpenAI credits
- Row-level security: client keys have no database access; all data flows through server-side API routes
- Document management: list, view, download, and delete uploaded files
- Built-in PDF viewer

## Architecture

```
Upload → Extract text → Chunk → Embed → Store in pgvector ──┐
                                                            ↓
Question → Exact-match cache? → Embed query → Semantic cache?
                 │ hit                             │ hit
                 ▼                                 ▼
           cached answer                     cached answer
                                                   │ miss
                                                   ▼
                              Similarity search → GPT answer → save to cache
```

### Ingestion pipeline

1. **Upload** — the file is stored in Supabase Storage.
2. **Extract** — text is extracted (pdf2json for PDF, mammoth for DOCX, raw UTF-8 for TXT) and cleaned.
3. **Chunk** — text is split into ~800-character chunks with 100-character overlap.
4. **Embed** — chunks are embedded in batches with OpenAI `text-embedding-3-small` (1536 dimensions).
5. **Store** — chunks, metadata, and embeddings are inserted into the `documents` table (pgvector).

### Query pipeline

1. **Rate limit** — 10 requests/minute per IP.
2. **Exact-match cache** — the normalized query is looked up in `query_cache`; a hit returns instantly with **no OpenAI calls at all**.
3. **Embed** — on a miss, the query is embedded with `text-embedding-3-small`.
4. **Semantic cache** — if a previously asked question is ≥ 0.97 cosine-similar (`match_cached_query`), its answer is reused, skipping the chat completion.
5. **Retrieve** — otherwise, the top 5 similar chunks are fetched via the `match_documents` RPC (similarity > 0.3).
6. **Generate** — `gpt-4o-mini` writes an answer from the retrieved context only, and the result is saved to the cache.

Cached responses include `"cached": true`. The cache is **invalidated automatically** whenever a document is uploaded or deleted, so answers never go stale.

## Tech Stack

- **Next.js** (App Router) — frontend and API routes
- **Supabase** — Postgres with the pgvector extension, plus file storage
- **OpenAI API** — embeddings (`text-embedding-3-small`) and chat completions (`gpt-4o-mini`)
- **LangChain text splitters** — recursive character chunking
- **Tailwind CSS** — styling

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/rojee-thapa/rag-search-app.git
cd rag-search-app
npm install
```

### 2. Configure environment variables

Create a `.env.local` file in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
OPENAI_API_KEY=your-openai-api-key
```

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Publishable (anon) key — safe to expose, but has **no** database access under RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required.** Server-only key used for all database and storage operations — never expose it to the browser |
| `OPENAI_API_KEY` | OpenAI API key for embeddings and chat completions |

`.env.local` is git-ignored and must never be committed.

### 3. Set up Supabase

Run these in the Supabase SQL editor, in order:

**a) Base schema** — pgvector, the `documents` table, and the similarity-search function:

```sql
create extension if not exists vector with schema extensions;

create table documents (
  id bigserial primary key,
  content text,
  metadata jsonb,
  embedding vector(1536)
);

create function match_documents (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where 1 - (documents.embedding <=> query_embedding) > match_threshold
  order by documents.embedding <=> query_embedding
  limit match_count;
$$;
```

**b) Answer cache** — run [`supabase/query_cache.sql`](supabase/query_cache.sql) (creates the `query_cache` table and `match_cached_query` function).

**c) Security** — run [`supabase/security.sql`](supabase/security.sql) (enables deny-all RLS on both tables, revokes client-role grants and RPC execution, and pins function `search_path`).

Finally, create a **public Storage bucket named `documents`** for the uploaded files.

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), upload a document, and start asking questions. Ask the same question twice — the second answer returns instantly from the cache.

## Security Model

- **RLS deny-all**: `documents` and `query_cache` have row-level security enabled with no policies, so the publishable key that ships in the browser bundle cannot read, write, or delete anything.
- **Server-only data access**: every database and storage operation goes through Next.js API routes using the service-role key.
- **Locked-down RPCs**: `match_documents` and `match_cached_query` cannot be executed by client roles, and both have a pinned `search_path`.
- **Abuse protection**: search is rate-limited per IP and query length is capped at 1000 characters.
- Uploaded files live in a public-read bucket under unguessable UUID filenames; make the bucket private and serve downloads through the API if you need stricter file privacy.

## Project Structure

```
app/
  page.tsx                 # Search / ask page
  documents/page.tsx       # Document management (list, view, delete)
  components/              # Navigation, UploadModal, PDFViewerModal
  api/
    upload/route.ts        # Ingestion pipeline + cache invalidation
    search/route.ts        # Cache lookups, retrieval, answer generation
    documents/route.ts     # List / fetch / download / delete documents
supabase/
  query_cache.sql          # Cache table + semantic-match function
  security.sql             # RLS and hardening
```

## Live Demo

> 🚧 Coming soon — a hosted demo link will be added here.

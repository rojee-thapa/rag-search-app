# RAG Search App

A **Retrieval-Augmented Generation (RAG)** application built with **Next.js**, **Supabase (pgvector)**, and **OpenAI**. Upload your documents and ask questions about them in natural language — answers are generated from the actual content of your files, with source citations.

## Features

- Upload PDF, DOCX, and TXT documents (up to 10 MB)
- Semantic search over document content using vector embeddings
- AI-generated answers grounded in your documents, with source chunks shown
- Document management: list, view, download, and delete uploaded files
- Built-in PDF viewer

## Architecture

```
Upload → Extract text → Chunk → Embed → Store in pgvector
                                              ↓
        Question → Embed query → Similarity search → GPT answer
```

1. **Upload** — the file is stored in Supabase Storage.
2. **Extract** — text is extracted (pdf2json for PDF, mammoth for DOCX, raw UTF-8 for TXT) and cleaned.
3. **Chunk** — text is split into ~800-character chunks with 100-character overlap.
4. **Embed** — chunks are embedded in batches with OpenAI `text-embedding-3-small` (1536 dimensions).
5. **Store** — chunks, metadata, and embeddings are inserted into the `documents` table (pgvector).
6. **Answer** — a query is embedded, similar chunks are retrieved via the `match_documents` RPC, and `gpt-4o-mini` generates an answer from that context.

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
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Publishable (anon) key for client-safe queries |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used for storage operations and the search RPC — never expose it to the browser |
| `OPENAI_API_KEY` | OpenAI API key for embeddings and chat completions |

### 3. Set up Supabase

Enable pgvector and create the `documents` table and `match_documents` function in the SQL editor:

```sql
create extension if not exists vector;

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

Also create a Storage bucket named `documents` for the uploaded files.

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), upload a document, and start asking questions.

## Live Demo

> 🚧 Coming soon — a hosted demo link will be added here.

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import type { SearchResult } from '../../types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role key for RPC
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_QUERY_LENGTH = 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
// Only reuse a cached answer when the new question is near-identical in
// meaning to a previous one (cosine similarity). Keep this high — at lower
// values, subtly different questions would get the wrong cached answer.
const CACHE_SIMILARITY_THRESHOLD = 0.97;

function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim();
}

// In-memory sliding-window rate limiter, keyed by client IP.
// Per-instance only, but enough to stop a single client from
// draining OpenAI credits on a small deployment.
const requestTimestamps = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (requestTimestamps.get(ip) ?? [])
    .filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestTimestamps.set(ip, recent);
    return true;
  }
  recent.push(now);
  requestTimestamps.set(ip, recent);
  return false;
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({
        error: 'Too many requests. Please wait a minute and try again.'
      }, { status: 429 });
    }

    const { query } = await req.json();

    if (typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json({
        error: 'Query must be a non-empty string'
      }, { status: 400 });
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json({
        error: `Query is too long. Maximum length is ${MAX_QUERY_LENGTH} characters.`
      }, { status: 400 });
    }

    const normalized = normalizeQuery(query);

    // Cache layer 1: exact match on the normalized query text.
    // A hit here costs zero OpenAI tokens (no embedding, no chat call).
    const { data: exactHit } = await supabase
      .from('query_cache')
      .select('answer, sources')
      .eq('normalized_query', normalized)
      .limit(1);

    if (exactHit && exactHit.length > 0) {
      return NextResponse.json({
        answer: exactHit[0].answer,
        sources: exactHit[0].sources ?? [],
        cached: true,
      });
    }

    // 1️⃣ Generate embedding for the user's query
    const emb = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query
    });

    // Cache layer 2: semantic match — the same question phrased differently.
    // We already paid for the (cheap) embedding; a hit here skips the
    // expensive chat completion. Best-effort: on RPC error fall through.
    const { data: semanticHit } = await supabase.rpc('match_cached_query', {
      query_embedding: emb.data[0].embedding,
      match_threshold: CACHE_SIMILARITY_THRESHOLD,
    });

    if (semanticHit && semanticHit.length > 0) {
      return NextResponse.json({
        answer: semanticHit[0].answer,
        sources: semanticHit[0].sources ?? [],
        cached: true,
      });
    }

    // 2️⃣ Call Supabase RPC to find similar documents
    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: emb.data[0].embedding, // Pass as array, NOT string
      match_threshold: 0.3,
      match_count: 5
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results = (data ?? []) as SearchResult[];

    // No relevant chunks: answer directly without calling the chat API
    if (results.length === 0) {
      return NextResponse.json({
        answer: "I couldn't find anything relevant in your documents for that question. Try rephrasing it, or upload a document that covers this topic.",
        sources: []
      });
    }

    // 3️⃣ Combine retrieved chunks into context
    const context = results.map((r) => r.content).join('\n---\n');

    // 4️⃣ Generate answer using OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant. Use the provided context to answer questions. If the answer is not in the context, say you do not know.' 
        },
        { 
          role: 'user', 
          content: `Context: ${context}\n\nQuestion: ${query}` 
        }
      ],
    });

    const answer = completion.choices[0].message.content;

    // Save to the cache for future identical/similar questions.
    // Best-effort: a cache write failure should never fail the search.
    await supabase
      .from('query_cache')
      .upsert(
        {
          query,
          normalized_query: normalized,
          embedding: emb.data[0].embedding,
          answer,
          sources: results,
        },
        { onConflict: 'normalized_query' }
      )
      .then(({ error: cacheError }) => {
        if (cacheError) console.error('query_cache write failed:', cacheError.message);
      });

    return NextResponse.json({ answer, sources: results });

  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Search failed'
    }, { status: 500 });
  }
}
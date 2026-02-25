import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role key for RPC
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    // 1️⃣ Generate embedding for the user's query
    const emb = await openai.embeddings.create({ 
      model: 'text-embedding-3-small', 
      input: query 
    });

    console.log('Query embedding length:', emb.data[0].embedding.length);
    console.log('First 5 values:', emb.data[0].embedding.slice(0,5));

    // 2️⃣ Call Supabase RPC to find similar documents
    const { data: results, error } = await supabase.rpc('match_documents', {
      query_embedding: emb.data[0].embedding, // Pass as array, NOT string
      match_threshold: 0.0,
      match_count: 5
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 3️⃣ Combine retrieved chunks into context
    const context = results?.map((r: any) => r.content).join('\n---\n') || '';

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

    return NextResponse.json({ 
      answer: completion.choices[0].message.content, 
      sources: results 
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
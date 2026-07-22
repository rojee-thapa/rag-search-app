import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import mammoth from 'mammoth';
import type { ChunkMetadata } from '../../types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Both clients need the service role key: the documents/query_cache tables
// have RLS enabled with no anon policies, so the anon key has no DB access.
const supabaseStorage = createClient(url, serviceKey || anonKey);
const supabase = createClient(url, serviceKey || anonKey);
const openai = new OpenAI();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const EMBEDDING_BATCH_SIZE = 100;

function safeDecodeURIComponent(str: string): string {
  try { 
    return decodeURIComponent(str); 
  } catch { 
    try { 
      return decodeURIComponent(str.replace(/%/g, '%25')); 
    } catch { 
      return str; 
    } 
  }
}

async function extractTextFromFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.pdf')) {
    const PDFParser = (await import('pdf2json')).default;
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser(null, true);
      pdfParser.on('pdfParser_dataError', (err) =>
        reject(new Error(`PDF parsing error: ${err instanceof Error ? err.message : err.parserError}`))
      );
      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        try {
          let fullText = '';
          pdfData.Pages?.forEach((page) =>
            page.Texts?.forEach((text) =>
              text.R?.forEach((r) =>
                r.T && (fullText += safeDecodeURIComponent(r.T) + ' ')
              )
            )
          );
          resolve(fullText.trim());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          reject(new Error(`Error extracting text: ${message}`));
        }
      });
      pdfParser.parseBuffer(buffer);
    });
  } else if (fileName.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } else if (fileName.endsWith('.txt')) {
    return buffer.toString('utf-8');
  } else {
    throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT files.');
  }
}

export async function POST(req: Request) {
  try {
    const file = (await req.formData()).get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({
        success: false,
        error: `File is too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
      }, { status: 413 });
    }

    function cleanExtractedText(text: string): string {
      const normalized = text.replace(/\s+/g, ' ').trim();
      if (!normalized) return normalized;

      // Some PDF extractors emit letter-spaced text ("C O S C 1 0 1").
      // Only de-space when the text is actually letter-spaced: an average
      // token length near 1 means most "words" are single characters.
      const tokens = normalized.split(' ');
      const avgTokenLength = normalized.replace(/ /g, '').length / tokens.length;
      if (avgTokenLength <= 1.5) {
        // Collapse runs of single letters/digits (C O S C → COSC),
        // leaving multi-character words untouched.
        return normalized.replace(
          /\b(?:[A-Za-z0-9] )+[A-Za-z0-9]\b/g,
          (run) => run.replace(/ /g, '')
        );
      }
      return normalized;
    }

    const documentId = crypto.randomUUID();
    const uploadDate = new Date().toISOString();
    const filePath = `${documentId}.${file.name.split('.').pop() || 'bin'}`;

    // Upload file to Supabase Storage
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { error: storageError } = await supabaseStorage.storage
      .from('documents')
      .upload(filePath, fileBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (storageError) {
      const msg = storageError.message || 'Unknown storage error';
      if (msg.includes('row-level security') || msg.includes('RLS')) {
        return NextResponse.json({ 
          success: false, 
          error: `Storage RLS error: ${msg}. Ensure SUPABASE_SERVICE_ROLE_KEY is set.` 
        }, { status: 500 });
      }
      return NextResponse.json({ 
        success: false, 
        error: `Failed to store file: ${msg}` 
      }, { status: 500 });
    }

    // Get public URL for the file
    const { data: urlData } = supabaseStorage.storage
      .from('documents')
      .getPublicUrl(filePath);

    // The file is now in storage: if any later step fails, remove the file
    // and any rows already inserted for this document so nothing is orphaned
    const cleanupOrphans = async () => {
      await Promise.allSettled([
        supabaseStorage.storage.from('documents').remove([filePath]),
        supabase.from('documents').delete().eq('metadata->>document_id', documentId),
      ]);
    };

    try {
      // Extract text from file
      const rawText = await extractTextFromFile(file);
      const text = cleanExtractedText(rawText);
      if (!text || text.trim().length === 0) {
        await cleanupOrphans();
        return NextResponse.json({
          error: 'Could not extract text from file'
        }, { status: 400 });
      }

      // Split text into chunks
      // Chunk size of 800 characters with 100-character overlap ensures
      // we don't lose context at chunk boundaries
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 100,
      });
      const chunks = await textSplitter.splitText(text);

      // Generate embeddings in batches (the API accepts an input array),
      // then insert all rows in a single batch call
      const embeddings: number[][] = [];
      for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        const emb = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: batch,
        });
        embeddings.push(...emb.data.map((d) => d.embedding));
      }

      const rows = chunks.map((chunk, i) => {
        const metadata: ChunkMetadata = {
          source: file.name,
          document_id: documentId,
          file_name: file.name,
          file_type: file.type || file.name.split('.').pop() || 'unknown',
          file_size: file.size,
          upload_date: uploadDate,
          chunk_index: i,
          total_chunks: chunks.length,
          file_path: filePath,
          file_url: urlData.publicUrl,
        };
        return { content: chunk, metadata, embedding: embeddings[i] };
      });

      const { error } = await supabase.from('documents').insert(rows);
      if (error) {
        await cleanupOrphans();
        return NextResponse.json({
          success: false,
          error: error.message
        }, { status: 500 });
      }

      // New content can change the right answer to any question, so
      // invalidate all cached answers. Best-effort — never fail the upload.
      const { error: cacheError } = await supabaseStorage
        .from('query_cache')
        .delete()
        .gte('id', 0);
      if (cacheError) console.error('query_cache invalidation failed:', cacheError.message);

      return NextResponse.json({
        success: true,
        documentId,
        fileName: file.name,
        chunks: chunks.length,
        textLength: text.length,
        fileUrl: urlData.publicUrl
      });
    } catch (pipelineError) {
      await cleanupOrphans();
      throw pipelineError;
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process file'
    }, { status: 500 });
  }
}
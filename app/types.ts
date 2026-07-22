// Shared types for document chunks and search results.

// Metadata stored alongside each chunk in the `documents` table.
export interface ChunkMetadata {
  source: string;
  document_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  upload_date: string;
  chunk_index: number;
  total_chunks: number;
  file_path: string;
  file_url: string;
}

// A row returned by the `match_documents` RPC.
export interface SearchResult {
  id: number;
  content: string;
  metadata: ChunkMetadata;
  similarity: number;
}

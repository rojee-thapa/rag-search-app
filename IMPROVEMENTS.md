# RAG Search App — Improvements Roadmap

A living checklist of everything we identified to improve the project.
Check items off as they ship. Estimates are focused dev time (not calendar time).

---

## Phase 0 — Prerequisite (must do first)

- [ ] **Fill in `.env.local`** with real values:
  ```
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=
  SUPABASE_SERVICE_ROLE_KEY=
  OPENAI_API_KEY=
  ```
- [ ] Confirm Supabase has the `vector` extension enabled, a `documents` table with a `vector(1536)` column, an HNSW index on `embedding`, a `match_documents` RPC, and a `documents` storage bucket.

Without these, nothing below will actually run.

---

## Phase 1 — Quick Wins (~6–8 hrs)

Small diffs, big returns. Safe to ship together.

- [ ] **1. Raise `match_threshold`** — `app/api/search/route.ts:27` — change `0.0` → `0.5`. (5 min)
- [ ] **2. Bump `match_count`** — `app/api/search/route.ts:28` — change `5` → `8`. (5 min)
- [ ] **3. Env validation with zod** — new `lib/env.ts`; fail fast with clear errors. (1 hr)
- [ ] **4. Centralize Supabase clients + config** — new `lib/supabase.ts`, `lib/config.ts`. (1–2 hrs)
- [ ] **5. Stream LLM answer** — `openai.chat.completions.create({ stream: true })` + Vercel AI SDK in `app/page.tsx`. (2–3 hrs)
- [ ] **24. Generated Supabase TypeScript types** — `supabase gen types typescript`; replace `any` in routes. (2–3 hrs)
- [ ] **25. CI pipeline** — GitHub Actions: lint + build on PR. (2–3 hrs)

---

## Phase 2 — Ingestion & Retrieval Quality (~1–2 weeks)

Makes uploads fast and retrieval much smarter.

- [ ] **6. Batch embeddings on upload** — `app/api/upload/route.ts:131–157` — pass an array to `embeddings.create`. (3–4 hrs)
- [ ] **7. Title/heading-enriched chunks** — prepend `"From '{file_name}' > '{heading}': ..."` before embedding. (2–3 hrs)
- [ ] **9. File deduplication by hash** — sha256 the file; reuse existing document if hash matches. (2–3 hrs)
- [ ] **8. Background ingestion + progress UI** — Inngest / Supabase Edge Function; poll `status` column; progress bar in `UploadModal`. (1–2 days)
- [ ] **15. Semantic / heading-aware chunking** — respect sentence/paragraph/heading boundaries; capture `page_number` + `heading` in metadata. (2–3 days)

---

## Phase 3 — Answer UX (~2–3 days)

Make answers feel instant and trustworthy.

- [ ] **10. Inline citations + jump-to-source** — ask LLM to cite `[1] [2]`; click opens `PDFViewerModal` at `#page=N&search=...`. (1–2 days)

*(Phase 3 depends on Phase 1 #5 streaming being done first.)*

---

## Phase 4 — Retrieval Accuracy (~1 week)

The biggest quality jumps.

- [ ] **13. Hybrid search (BM25 + vector + RRF)** — add `tsvector` column, new `match_documents_hybrid` RPC. (2–3 days)
- [ ] **14. Re-ranker** — retrieve top-20, rerank with Cohere Rerank (or `bge-reranker-base`), keep top-5. (1 day)
- [ ] **18. Evaluation harness** — CSV of `(question, expected_chunk, expected_contains)` + Recall@5 + MRR script. (1–2 days)

*Build #18 early — it makes every other change measurable.*

---

## Phase 5 — Multi-User & Data Model (~3–5 days)

Turn it from a demo into something usable by real users.

- [ ] **11. Split `documents` table into `files` + `chunks`** — dedicated SQL migration. (1 day)
- [ ] **12. Auth + RLS** — Supabase Auth (email/Google), `user_id` column, row-level security policies. (1–2 days)

---

## Phase 6 — New Capabilities (~1–2 weeks)

- [ ] **16. Chat mode (multi-turn)** — `/api/chat`, threads table, follow-up questions. (3–4 days)
- [ ] **17. Collections / folders** — group documents; scope searches. (2–3 days)

---

## Phase 7 — Polish (~4–6 days)

- [ ] **19. Upload UX** — drag-drop, multi-file queue, per-file progress. (1 day)
- [ ] **20. Modal accessibility** — `role="dialog"`, focus trap, Escape to close, aria labels. (3–4 hrs)
- [ ] **21. Keyboard shortcuts** — `⌘K` focus search, `U` open upload, `Esc` close. (2–3 hrs)
- [ ] **22. Error + cost telemetry** — Sentry + `usage` table tracking tokens per request. (1 day)
- [ ] **23. Query caching** — hash query; reuse recent answer. (3–4 hrs)

---

## Recommended order

For the shortest path to "noticeably better":

1. Phase 0 (unblock the app)
2. Phase 1 items 1, 2, 3, 4 (foundation)
3. Phase 2 items 6, 7 (fast uploads + richer embeddings)
4. Phase 1 item 5 + Phase 3 item 10 (streaming answers with citations — biggest UX win)
5. Phase 4 items 13, 14 (biggest accuracy win)
6. Phase 4 item 18 in parallel (measure the wins)
7. Phase 5 (once you have real users)
8. Phase 6 + 7 (turn it into a product)

---

## Time summary

| Phase | Scope | Focused time |
|---|---|---|
| 0 | Env + Supabase setup | ~1–2 hrs |
| 1 | Quick wins | ~1 day |
| 2 | Ingestion + retrieval | ~1–2 weeks |
| 3 | Answer UX | ~2–3 days |
| 4 | Accuracy | ~1 week |
| 5 | Multi-user | ~3–5 days |
| 6 | New features | ~1–2 weeks |
| 7 | Polish | ~4–6 days |
| **Total (solo, focused)** | All 25 items | **~7–8 weeks** |

Calendar estimates:
- Part-time (~15 hrs/week): ~4–5 months
- Full-time (~40 hrs/week): ~8–10 weeks
- Pair (2 devs, full-time): ~5–6 weeks

Shortest path to >80% of quality + UX gains: items **1, 2, 5, 6, 7, 10, 13, 14** (~8–10 days).

---

## Notes / decisions log

_Record choices, tradeoffs, and blockers here as you go._

- (empty)

# Pulse V2 Phase 3C.1 — pgvector Enablement + Validation

**Date:** 2026-08-22  
**Depends on:** Phase 3A–3C  
**Scope:** Enable native `pgvector` for `MemoryChunk` only  
**Ask Pulse routing:** unchanged  
**MEMORY_V2_ASK_MODE:** unchanged (still default `LEGACY_ONLY`)  
**V2_PRIMARY:** not enabled  
**Legacy retrieval:** not removed  
**Schema migration (Prisma):** NO — column added via runtime/SQL (same pattern as `KnowledgeEmbedding`)

---

## 1. PostgreSQL environment

| Item | Value |
|------|-------|
| Runtime | Local Windows service `postgresql-x64-18` |
| Version | PostgreSQL **18.4** (x86_64-windows, MSVC) |
| Database | `teampulse` via `DATABASE_URL` |
| Docker | **Not used** (`docker` not installed) |
| Project docker-compose | **None** |

---

## 2. Root cause of prior unavailability

`CREATE EXTENSION vector` failed with:

```text
ERROR:  extension "vector" is not availablef
HINT:  The extension must first be installed on the system where PostgreSQL is running.
```

`pg_available_extensions` had **no** `vector` row.

**Cause:** EDB/local PostgreSQL 18 install did not ship pgvector control files / `vector.dll` under:

- `C:\Program Files\PostgreSQL\18\lib\`
- `C:\Program Files\PostgreSQL\18\share\extension\`

This is an **OS/package gap**, not an application bug. Phase 3A correctly fell back to `json_acl_bounded`.

---

## 3. How pgvector was enabled

1. Built official **pgvector v0.8.6** from source with Visual Studio 2022 Community (`nmake /F Makefile.win`, `PGROOT=C:\Program Files\PostgreSQL\18`).
2. Installed (elevated copy) into PostgreSQL:
   - `lib\vector.dll`
   - `share\extension\vector.control`
   - `share\extension\vector--0.8.6.sql` (+ related SQL)
3. Ran: `CREATE EXTENSION IF NOT EXISTS vector;`

Operator re-run path documented:

```bash
# after system files are present
npm run memory:pgvector-enable
# optional workspace scope:
npm run memory:pgvector-enable -- --workspaceId=<uuid>
```

---

## 4. Extension version

```sql
SELECT extversion FROM pg_extension WHERE extname = 'vector';
-- 0.8.6
```

---

## 5. MemoryChunk.embedding_vec

Ensured by Phase 3A `MemoryVectorSearchService.ensureNativeColumn()` and `memory:pgvector-enable`:

```sql
ALTER TABLE "MemoryChunk"
  ADD COLUMN IF NOT EXISTS embedding_vec vector(1536);
```

JSON `embedding` / `embeddingModel` / `embeddingDimensions` **retained**.

---

## 6. Vector dimensions

**1536** (`text-embedding-3-small` / `DEFAULT_EMBEDDING_DIMENSIONS`)

---

## 7. ANN index

```text
MemoryChunk_embedding_vec_hnsw_idx
USING hnsw (embedding_vec vector_cosine_ops)
```

Cosine distance operator `<=>` matches Phase 3A similarity = `1 - distance`.

---

## 8. Existing vectors synchronized

From `npm run memory:pgvector-enable` (whole DB):

| Metric | Count |
|--------|------:|
| MemoryChunk total | 184 |
| with JSON embedding | 184 |
| compatible (dims=1536, model=text-embedding-3-small) | 184 |
| embedding_vec before sync | 66 |
| **synced this run** | **118** |
| skipped (already present / incompatible) | 66 |
| failed | 0 |
| embedding_vec after | **184** |

JSON embeddings were **not** deleted.

---

## 9. Worker validation

Phase 2B `MemoryIndexWorkerService` already calls `MemoryVectorSearchService.syncNativeVector` after JSON upsert. **No duplicate sync logic added.**

---

## 10. Retrieval validation

`test:memory-phase3c1` proved:

- `vectorBackend = pgvector` (not `json_acl_bounded`)
- semantic candidate returned via native vector path
- unauthorized TEAM chunk with identical vector **absent** (ACL before result)

---

## 11. Readiness before → after

| | Before | After |
|--|--------|-------|
| vectorBackend | `json_acl_bounded` | **`pgvector`** |
| Vector readiness | `BOUNDED_JSON_ONLY` / gate **BLOCKED** | **`PGVECTOR_READY`** / gate **PASS** |
| Overall readiness | BLOCKED (pgvector) | BLOCKED (**coverage** — indexedRatio still low) |
| Recommended mode | `V2_SHADOW` | **`HYBRID`** (recommendation only; mode not mutated) |

pgvector is **no longer** the release blocker. Remaining overall BLOCKED is **historical coverage** (eligible vs indexed), not vector backend.

---

## 12. Files created / modified

**Created**

- `backend/scripts/memory-pgvector-enable.ts`
- `backend/src/memory/memory-phase3c1.spec.ts`
- `docs/PULSE_V2_PHASE3C1_PGVECTOR_ENABLEMENT.md`

**Modified**

- `backend/package.json` — `memory:pgvector-enable`, `test:memory-phase3c1`
- `backend/src/memory/memory-vector-search.service.ts` — pgvector incompatible model/dims count
- `backend/src/memory/memory-phase3a.spec.ts` — sync fixtures to `embedding_vec` when pgvector active
- `backend/src/memory/memory-phase3c.spec.ts` — accept `PGVECTOR_READY`

**Not changed**

- Ask Pulse / RagPipeline routing
- Live Jira authority
- Ingestion/chunking
- Legacy collectors

---

## 13. Regressions

| Suite | Result |
|-------|--------|
| `tsc --noEmit` | PASS |
| `test:memory-phase3a` | PASS |
| `test:memory-phase3b` | PASS |
| `test:memory-phase3c` | PASS |
| `test:memory-phase3c1` | PASS |
| `test:ai-retrieval` | PASS |

---

## 14. Risks

- Local Windows require admin to install `vector.dll` into Program Files  
- Rebuild needed after PostgreSQL major upgrades  
- HNSW build cost grows with corpus size  
- Coverage gate still blocks overall V2_PRIMARY eligibility  
- Production Linux should use distro/pgvector packages or `pgvector/pgvector` image — not this Windows compile path  

---

## 15. Intentionally NOT done

- No Ask Pulse HYBRID/V2_PRIMARY enablement  
- No Phase 3D  
- No legacy retirement  
- No Prisma migration file (runtime ADD COLUMN matches KnowledgeEmbedding pattern)  
- No OS package manager auto-install beyond explicit pgvector build/copy for this machine  

---

## 16. Next (operator)

1. Keep Ask mode `LEGACY_ONLY` or move carefully to `V2_SHADOW`  
2. Improve Phase 2C coverage (indexed eligible %) before V2_PRIMARY readiness  
3. Do **not** auto-enable V2_PRIMARY

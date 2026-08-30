# Unit Test Phase 2 Report — MemoryChunkerService

**Date:** August 28, 2026  
**Phase:** 2 — Pure-logic memory pipeline unit tests  
**Status:** Complete — awaiting approval before Phase 3  
**Service under test:** `MemoryChunkerService` (`pulse/backend/src/memory/memory-chunker.service.ts`)  
**Test suite:** `pulse/backend/src/memory/memory-chunker.service.unit.spec.ts`

---

> **Phase 2 outcome:** A complete Jest unit test suite for `MemoryChunkerService` achieves **100% coverage** across all metrics with **30 passing tests** and **zero production code changes**.

---

## Table of Contents

1. [Objective](#objective)
2. [Service Analysis](#service-analysis)
3. [Why This Service Was Selected](#why-this-service-was-selected)
4. [Files Created](#files-created)
5. [Files Modified](#files-modified)
6. [Execution](#execution)
7. [Test Cases Implemented](#test-cases-implemented)
8. [Mocking Strategy](#mocking-strategy)
9. [Coverage Report](#coverage-report)
10. [Test Execution Result](#test-execution-result)
11. [CI Readiness](#ci-readiness)
12. [Quality Assessment](#quality-assessment)
13. [Lessons Learned](#lessons-learned)
14. [Remaining Uncovered Scenarios](#remaining-uncovered-scenarios)
15. [Phase Summary](#phase-summary)
16. [Next Recommended Service](#next-recommended-service)
17. [Approval Gate](#approval-gate)

---

## Objective

Extend the Jest unit testing program (started in Phase 1 with `DigestService`) to the memory ingestion pipeline. Phase 2 targets `MemoryChunkerService` — a zero-dependency service that transforms normalized memory sources into deterministic, embeddable text chunks.

---

## Service Analysis

### What the service does

`MemoryChunkerService` is the **deterministic text chunking layer** in the Pulse V2 memory worker pipeline. It accepts a `NormalizedMemorySource` (an intermediate representation decoupled from Prisma entity shapes) and produces an ordered array of `PreparedMemoryChunk` objects ready for embedding and storage.

Each prepared chunk contains:

| Field | Purpose |
|-------|---------|
| `chunkIndex` | Sequential index across all chunks from the source |
| `text` | Header + body text used for embedding |
| `title` | Section or part title for display / retrieval |
| `contentHash` | SHA-256 digest of `text` for idempotent upserts |

The service also exports two pure helpers:

| Export | Purpose |
|--------|---------|
| `hashChunkContent(text)` | SHA-256 hex digest of chunk text |
| `sectionsFromNormalized(source)` | Resolves section list or synthesizes a body section |

Internally, `splitDeterministic` splits long text using configurable `maxChunkChars` (default **1800**) and `chunkOverlapChars` (default **120**) from `MEMORY_WORKER_CONFIG`, preferring breaks at paragraph → newline → sentence → word boundaries.

### Why it is a good candidate for unit testing

| Criterion | Assessment |
|-----------|------------|
| **Dependencies** | Zero constructor injections — no Prisma, OpenAI, Slack, or network |
| **Determinism** | Same input always produces identical chunks and hashes |
| **Business logic density** | Section routing, splitting heuristics, overlap, hashing |
| **Risk surface** | Incorrect chunking corrupts downstream embeddings and retrieval |
| **Testability** | All behavior reachable via `prepareChunks()` and exported helpers |
| **CI suitability** | Runs in milliseconds with no infrastructure |

### Business logic contained

1. **Section vs. body routing** — Uses `source.sections` when non-empty; otherwise falls back to `source.text` as a single `body` unit.
2. **Whitespace normalization** — Trims section/body text; skips empty sections; normalizes `\r\n` → `\n` before splitting.
3. **Title resolution** — Section title defaults to `source.title` when a section has no title.
4. **Deterministic splitting** — Splits text exceeding `maxChunkChars` with overlap; prefers natural break points when they occur after 40% of the window.
5. **Multi-part headers** — Adds `(key part N/M)` suffix when a section spans multiple chunks.
6. **Content hashing** — SHA-256 digest per chunk for deduplication and rebuild detection.
7. **Section list helper** — `sectionsFromNormalized` synthesizes a body section when no sections array is present.

---

## Why This Service Was Selected

Phase 1 established the Jest + `@nestjs/testing` pattern on `DigestService`. Phase 2 naturally progresses to the **next zero-dependency service** on the roadmap:

- Continues the pure-logic testing pattern without introducing Prisma mocks
- Covers a **critical memory pipeline step** used by `MemoryIndexWorkerService`
- Exercises **exported pure functions** (`hashChunkContent`, `sectionsFromNormalized`) in addition to the NestJS service class
- Validates **configuration-driven behavior** (`maxChunkChars`, `chunkOverlapChars`) through observable outputs

---

## Files Created

| File | Purpose |
|------|---------|
| `pulse/backend/src/memory/memory-chunker.service.unit.spec.ts` | Jest unit tests for `MemoryChunkerService` and exported helpers (30 test cases) |
| `pulse/docs/testing/unit-test-phase2-report.md` | This report |

---

## Files Modified

**None.** No production code changes were required.

---

## Execution

All commands below should be run from the backend root directory:

```bash
cd pulse/backend
```

### Run all Jest unit tests (Phase 1 + Phase 2)

```bash
npm test
```

### Run only MemoryChunkerService tests

```bash
npm test -- --testPathPattern="memory-chunker.service.unit.spec"
```

### Run MemoryChunkerService tests with scoped coverage

```bash
npm test -- --coverage --collectCoverageFrom="src/memory/memory-chunker.service.ts" --testPathPattern="memory-chunker.service.unit.spec"
```

### Run full coverage report

```bash
npm run test:coverage
```

---

## Test Cases Implemented

All tests follow **Arrange – Act – Assert (AAA)** with descriptive names. A shared `makeSource()` factory builds valid `NormalizedMemorySource` fixtures.

| Category | Tests | Description |
|----------|------:|-------------|
| Normal inputs | 3 | Short body; multi-section; missing section title fallback |
| Empty input | 3 | Blank body; whitespace-only sections; empty sections array fallback |
| Null / undefined | 3 | Undefined sections; null/undefined source throws at runtime |
| Boundary conditions | 2 | Exactly `maxChunkChars`; one character over limit |
| Large text & overlap | 3 | Multi-part headers; overlap between chunks; `\r\n` normalization |
| Split break points | 4 | Paragraph, hard split, newline, sentence boundaries |
| Hash generation | 2 | SHA-256 format; different inputs → different hashes |
| Edge cases | 4 | Body/section trimming; title trimming; sequential `chunkIndex` |
| `hashChunkContent` | 3 | Determinism; distinct inputs; canonical digest |
| `sectionsFromNormalized` | 3 | Existing sections; absent sections; empty array |
| **Total** | **30** | **All passing** |

### `prepareChunks` — normal inputs (3 tests)

- Single chunk for short body text under `maxChunkChars`
- Separate chunks per non-empty section
- Falls back to `source.title` when section title is absent

### `prepareChunks` — empty input (3 tests)

- Blank body text → `[]`
- All-whitespace sections → `[]`
- Empty `sections: []` falls back to body text

### `prepareChunks` — null / undefined (3 tests)

- `sections: undefined` uses body path
- `null` source throws at runtime
- `undefined` source throws at runtime

### `prepareChunks` — boundary conditions (2 tests)

- Text length exactly equal to `maxChunkChars` → single chunk
- Text length `maxChunkChars + 1` → multiple chunks with part header

### `prepareChunks` — large text & overlap (3 tests)

- Long text produces numbered multi-part headers
- Consecutive chunk bodies share configured overlap content
- Windows `\r\n` line endings normalized before splitting

### `prepareChunks` — deterministic split break points (4 tests)

- Prefers `\n\n` paragraph breaks
- Hard splits when no break point exceeds 40% of window (continuous `z` string)
- Breaks on single `\n` when paragraphs unavailable
- Breaks on `. ` sentence boundaries

### `prepareChunks` — hash generation (2 tests)

- Each chunk receives a 64-char hex SHA-256 `contentHash`
- Different chunk text produces different hashes

### `prepareChunks` — edge cases (4 tests)

- Body text trimmed before chunking
- Section text trimmed before chunking
- Section title trimmed
- Sequential `chunkIndex` across multiple sections

### `hashChunkContent` (3 tests)

- Deterministic output for same input
- Different inputs produce different digests
- Matches Node.js `crypto.createHash('sha256')` for canonical string

### `sectionsFromNormalized` (3 tests)

- Returns existing sections when present
- Synthesizes body section when sections absent
- Synthesizes body section when sections array is empty

---

## Mocking Strategy

| Dependency | Mocked? | Rationale |
|------------|---------|-----------|
| `MemoryChunkerService` deps | No | Zero constructor injections |
| `PrismaService` | No | Not used |
| `OpenAI` / embeddings | No | Not used |
| `Slack` | No | Not used |
| `MEMORY_WORKER_CONFIG` | No | Uses default config values; assertions reference constants directly |

> **Design principle:** No mocks were introduced. Tests use real `MEMORY_WORKER_CONFIG` defaults (`maxChunkChars: 1800`, `chunkOverlapChars: 120`) and programmatically generated inputs sized relative to those constants.

---

## Coverage Report

Command:

```bash
npm test -- --coverage --collectCoverageFrom="src/memory/memory-chunker.service.ts" --testPathPattern="memory-chunker.service.unit.spec"
```

| Metric | Result |
|--------|--------|
| **Statements** | 100% |
| **Branches** | 100% |
| **Functions** | 100% |
| **Lines** | 100% |

**100% coverage is achievable** for this service because all logic lives in pure, synchronous functions with no unreachable defensive branches or external I/O fallbacks.

---

## Test Execution Result

Captured by executing the MemoryChunkerService unit test suite on **August 28, 2026**:

### Scoped run (`memory-chunker.service.unit.spec.ts`)

```
PASS src/memory/memory-chunker.service.unit.spec.ts

Test Suites: 1 passed, 1 total
Tests:       30 passed, 30 total
Snapshots:   0 total
Time:        5.622 s
```

| Metric | Value |
|--------|-------|
| **Passing tests** | 30 passed, 30 total |
| **Execution time** | 5.622 s |

#### Coverage summary (`memory-chunker.service.ts`)

| Metric | Coverage |
|--------|----------|
| **Statements** | 100% |
| **Branches** | 100% |
| **Functions** | 100% |
| **Lines** | 100% |

### Combined run (Phase 1 + Phase 2)

```
PASS src/digest/digest.service.unit.spec.ts
PASS src/memory/memory-chunker.service.unit.spec.ts

Test Suites: 2 passed, 2 total
Tests:       58 passed, 58 total
Snapshots:   0 total
Time:        7.734 s
```

> **Note:** Execution time may vary slightly by machine and load.

---

## CI Readiness

| Requirement | Required for Phase 2? |
|-------------|:---------------------:|
| PostgreSQL connection | No |
| Prisma connection | No |
| Slack connection | No |
| OpenAI connection | No |
| External network access | No |

The MemoryChunkerService suite is **fully CI-ready**: deterministic, isolated, fast (~6 s), and compatible with the same GitHub Actions step established in Phase 1 (`npm test`).

---

## Quality Assessment

| Criterion | Status | Explanation |
|-----------|:------:|-------------|
| **AAA Pattern** | ✅ | Every test separates fixture setup, method invocation, and assertions |
| **Independent Tests** | ✅ | Each test builds its own `NormalizedMemorySource` via `makeSource()` |
| **No Shared State** | ✅ | Fresh `TestingModule` per test in `beforeEach` |
| **Deterministic Output** | ✅ | Chunking and hashing are pure functions of input text |
| **Readable Test Names** | ✅ | Names describe behavior, not implementation |
| **Maintainable Structure** | ✅ | Nested `describe` blocks; shared factory; helper `chunkBody()` |
| **Fast Execution** | ✅ | ~6 s for 30 tests, no I/O |
| **Zero External Dependencies** | ✅ | No database, network, or third-party API calls |

---

## Lessons Learned

1. **Test exported helpers directly.** `hashChunkContent` and `sectionsFromNormalized` are part of the public module surface (the latter is explicitly exported for tests). Direct tests improve coverage clarity and document API contracts.

2. **Size inputs relative to config constants.** Using `MEMORY_WORKER_CONFIG.maxChunkChars` in test data keeps tests valid if env overrides change defaults.

3. **Cover all split break priorities.** The private `splitDeterministic` function has four break-point strategies plus a hard-split fallback; each is reachable with crafted input strings.

4. **Runtime null checks are worth documenting.** TypeScript types require `NormalizedMemorySource`, but runtime `null`/`undefined` throws — tested to document defensive expectations.

5. **Avoid hardcoded SHA-256 literals.** Assert against `createHash('sha256').update(input).digest('hex')` to prevent incorrect expected values.

6. **Phase 1 patterns transfer cleanly.** Same `Test.createTestingModule` setup, AAA structure, and `*.unit.spec.ts` naming convention required no tooling changes.

---

## Remaining Uncovered Scenarios

At **100% line and branch coverage**, there are no uncovered code paths in `memory-chunker.service.ts`.

The following are **intentionally out of scope** for this unit suite:

| Scenario | Deferred to |
|----------|-------------|
| End-to-end chunk → embed → store pipeline | `memory-phase2b.spec.ts` / integration tests |
| Custom env overrides (`MEMORY_CHUNK_MAX_CHARS`) | Config integration tests (optional) |
| `MemoryIndexWorkerService` orchestration | Worker integration tests |
| Embedding provider interaction | `MemoryEmbeddingService` unit tests (Phase 3+) |

---

## Phase Summary

### What was accomplished

- Implemented **30 Jest unit tests** for `MemoryChunkerService` and its exported helpers
- Achieved **100% coverage** (statements, branches, functions, lines)
- Validated section routing, deterministic splitting, overlap, hashing, and edge cases
- Combined project test count: **58 passing tests** across Phase 1 and Phase 2
- Zero production code modifications

### Why MemoryChunkerService was chosen

It was the natural Phase 2 target: zero dependencies, high business logic density, and a critical role in the memory indexing pipeline. It extended Phase 1 patterns without introducing Prisma or external service mocks.

### What we learned

- Pure memory pipeline logic is fully unit-testable with programmatic string fixtures
- Private split heuristics can be exercised entirely through `prepareChunks()` outputs
- Exported test helpers (`sectionsFromNormalized`) should be tested alongside the service class

### Why this strengthens the testing foundation

Phase 2 proves the Jest program scales beyond digest formatting into the **memory ingestion domain** — a core differentiator for Pulse AI. The next increment (Phase 3) can introduce the first **Prisma mock pattern** on `QuestionsService` without reworking infrastructure.

---

## Next Recommended Service

**`QuestionsService`** (`pulse/backend/src/questions/questions.service.ts`)

| Criterion | QuestionsService |
|-----------|-----------------|
| Dependencies | `PrismaService` |
| Logic | CRUD + validation + reorder transactions |
| Lines | ~89 |
| Mocks needed | Prisma mock factory |
| Expected coverage | 90%+ |
| New pattern | First `PrismaService` mock; exception testing (`NotFoundException`, `BadRequestException`) |

**Alternative:** Continue pure-logic momentum with `TimelineBuilderService`, `ResponseRendererService`, or `MemoryHybridRankingService` (all zero-dependency).

---

## Approval Gate

Phase 2 is complete. **Do not proceed to Phase 3** until approved.

Suggested next step upon approval: implement `questions.service.unit.spec.ts` (Prisma mock pattern) or continue pure-logic services from Tier 1.

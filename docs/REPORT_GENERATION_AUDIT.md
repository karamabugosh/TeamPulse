# Report Generation Audit

**Date:** 2026-08-23  
**Scope:** Reports module, AI Workspace analytics, Overview/Dashboard consistency  
**Goal:** Reports and analytics must reflect the **current** state of the selected workspace from PostgreSQL — no fabricated stats, stale cache, or cross-workspace leakage.

---

## 1. Current Report Pipeline

### Two report paths (by design)

| Path | Purpose | Data source |
|------|---------|-------------|
| **Saved standup digests** | Historical Check-In reports (Slack parity) | `AiDigest` rows written at run completion |
| **Dynamic workspace reports** | Ask Pulse / AI Workspace “generate report” | `WorkspaceAnalyticsService` → `ReportMetricsService` → `ReportGenerationService` |

Saved digests remain **historical artifacts** (what was true at run time).  
**Numeric KPIs** across Reports page, Overview, Blockers, and AI now come from **`WorkspaceAnalyticsService`** (recalculated on each request).

### Flow (dynamic reports)

```
Reports page open / POST /api/ai/workspace/reports/generate
        │
        ▼
ReportGenerationService.generate()
        │
        ▼
ReportMetricsService.collect()
        │
        ▼
WorkspaceAnalyticsService.collectSnapshot()
        ├── refreshJiraCacheIfConnected()  → Live Jira → JiraIssueCacheEntry
        ├── JiraBlockerService.listDashboardBlockersForWorkspace()
        ├── computeBlockerStats()          → same rules as Blockers page
        ├── StandupSubmission / StandupRun   → workspaceId scoped
        ├── JiraIssueCacheEntry              → workspaceId scoped
        └── WorkspaceMembersService          → workspaceId scoped
        │
        ▼
ReportGenerationService.buildSections() + AI narrative (facts JSON only)
```

---

## 2. Data Sources

| Metric | Table / Service | Workspace filter |
|--------|-----------------|------------------|
| Standups | `StandupSubmission`, `StandupRun`, `CheckInParticipant` | `workspaceId` via team/run/user |
| Blockers | `PulseBlocker` via **`JiraBlockerService`** | `PulseBlocker.workspaceId` |
| Jira | `JiraIssueCacheEntry` (+ Live refresh) | `workspaceId` |
| Members | `User` via **`WorkspaceMembersService`** | `workspaceId` |
| Team memory | Not used for numeric KPIs | — |
| Prior reports (`AiDigest`) | Narrative/history only in report text | `team.workspaceId` |
| Demo data | Excluded when workspace is not Demo | connection guards |

**Never used for counts:** previously generated `AiDigest.blockers`, truncated `take:200` blocker lists, or `status = 'open'` only queries.

---

## 3. SQL / Prisma Queries (authoritative)

### Blockers (shared with Blockers page + AI)

```typescript
// jira-blocker.service.ts
prisma.pulseBlocker.findMany({
  where: { workspaceId, ...(teamId ? { teamId } : {}) },
  // NO take/limit
});
computeBlockerStats(blockers); // blocker-stats.util.ts
```

### Standups

```typescript
prisma.standupSubmission.findMany({
  where: { ...workspaceSubmissionFilter(workspaceId), date range },
});
prisma.standupRun.count({
  where: { team: { workspaceId }, scheduledFor: range },
});
```

### Jira

```typescript
// Before metrics: Live Jira refresh when connected
jiraCache.refreshUserCache(connection.userId);

prisma.jiraIssueCacheEntry.findMany({
  where: { workspaceId },
  orderBy: { refreshedAt: 'desc' },
});
// De-dupe by issueKey — freshest row wins
```

### Members

```typescript
workspaceMembers.listHumanMembers(workspaceId, { bypassCache: true });
prisma.checkInParticipant.findMany({
  where: { checkIn: { team: { workspaceId }, enabled: true }, isActive: true },
});
```

---

## 4. Report Calculation Flow

1. Resolve `workspaceId` from request context (`X-Workspace-Id` / active workspace).
2. **Optional Live Jira refresh** → upsert `JiraIssueCacheEntry`.
3. Load **full** blocker list → `computeBlockerStats` (open = not resolved/closed).
4. Aggregate standups, Jira cache, members in parallel Prisma queries.
5. Build deterministic markdown sections in `ReportGenerationService`.
6. AI summary receives **JSON facts only** — must not invent numbers.
7. Debug log: workspaceId, standup count, Jira count, blocker count, members, generation ms, Live Jira refresh, queries executed.

---

## 5. Changes Made

### New files

| File | Role |
|------|------|
| `backend/src/analytics/workspace-analytics.service.ts` | **Single source of truth** for workspace KPIs |
| `backend/src/analytics/workspace-analytics.types.ts` | Snapshot types |
| `backend/src/analytics/analytics.module.ts` | Nest module |
| `backend/src/analytics/report-analytics-consistency.spec.ts` | Consistency tests |

### Refactored

| File | Change |
|------|--------|
| `report-metrics.service.ts` | Delegates to `WorkspaceAnalyticsService`; blockers no longer use custom open filter or `take:200` |
| `admin.service.ts` | Overview + Analytics use analytics service; removed fabricated trend/speed percentages; top blockers from `PulseBlocker` |
| `admin.controller.ts` | Added `GET /api/admin/analytics/snapshot` |
| `jira-hub.service.ts` | Open blockers via `JiraBlockerService` (not `status='open'` only) |
| `ReportsPage.tsx` | Live KPI cards from `/api/admin/analytics/snapshot` on load + 15s refresh |
| `ai.module.ts`, `admin.module.ts` | Import `AnalyticsModule` |

### Unchanged (already correct)

| File | Notes |
|------|-------|
| `jira-blocker.service.ts` | Already SSOT for Blockers page + AI RAG |
| `blocker-stats.util.ts` | Canonical open/critical/resolved rules |
| `report-generation.service.ts` | AI constrained to metrics JSON |
| `workspace-knowledge.service.ts` | AI blockers via `getBlockerStatsForWorkspace` |

---

## 6. Validation Results

```bash
cd pulse/backend
npx tsc --noEmit
npm run test:report-analytics
npm run test:jira-authority
npm run test:memory-phase3b
```

| Test | Result |
|------|--------|
| TypeScript compile | Pass |
| `report-analytics-consistency.spec.ts` | Pass |
| `blockers-consistency.spec.ts` | Pass |
| `jira-authority.spec.ts` | Pass |

---

## 7. Consistency Checks

These surfaces now share **`JiraBlockerService` + `computeBlockerStats`** for blocker counts:

| Surface | Endpoint / Service |
|---------|-------------------|
| Blockers page | `GET /api/blockers/stats` |
| AI Workspace (GET_BLOCKERS) | `WorkspaceKnowledgeService.collectBlockersFromDashboard` |
| Reports KPI cards | `GET /api/admin/analytics/snapshot` |
| Overview stats | `GET /api/admin/overview` → `stats.openBlockers` |
| Analytics page | `GET /api/admin/analytics` |
| Jira Hub overview | `JiraHubService.getOverview` |
| Dynamic AI reports | `ReportMetricsService` → analytics snapshot |

**Open blocker definition (all surfaces):** status is not `resolved` and not `closed` (includes open, waiting, in_progress, investigating).

---

## 8. Remaining Issues

1. **Saved AiDigest reports** — Historical standup digests still store AI-generated text at run time. The Reports list shows these for Slack parity; KPI cards above them are live. Re-generating a digest on view would be a separate feature.

2. **Jira refresh scope** — `refreshUserCache` refreshes visible issues for the connected user (~50 issues), not the entire Jira site. Full-site sync would need a dedicated batch job.

3. **Overview `buildAiAnalytics` narrative** — Productivity trend and insights still reference latest **stored** AI digest for qualitative text; **counts** use analytics service.

4. **Multi-source-rag.spec.ts** — Pre-existing source-selection assertion may fail independently of this work.

5. **TeamMemoryDocument** — Not included in numeric KPIs (by design); used only for RAG context.

---

## API Reference

### Live workspace snapshot (recalculated every call)

```
GET /api/admin/analytics/snapshot
```

Returns full `WorkspaceAnalyticsSnapshot` including debug fields (`queriesExecuted`, `liveJiraRefresh`, `generationMs`).

### Dynamic report generation

```
POST /api/ai/workspace/reports/generate
```

Uses same analytics pipeline; AI summary sections reference computed metrics only.

---

## Debug Logging Example

```
[WorkspaceAnalytics] WorkspaceId: … | Standups: 42 (35 completed) | Jira Issues: 87 | Blockers: 12 (8 open) | Members: 7 | GenerationMs: 234 | Live Jira Refresh: attempted=true success=true issues=50 | Queries: workspace.findUnique, jiraCache.refreshUserCache, …
```

# Unit Test Report — MemoryAclService

**Date:** August 30, 2026  
**Service:** `src/memory/memory-acl.service.ts`  
**Suite:** `src/memory/memory-acl.service.unit.spec.ts`  
**Branch:** `karam-final1`

---

## Responsibilities

Resolves trusted ACL context from Pulse membership tables and builds SQL / in-memory authorization checks for Memory V2 chunks. Never trusts client-supplied team IDs.

## Public API

| Method | Purpose |
|--------|---------|
| `resolveContext` | Load user + team memberships → `MemoryAclContext` |
| `buildAclSql` | Parameterized SQL fragment for chunk visibility |
| `isChunkAuthorized` | Defense-in-depth check on loaded rows |

## Dependencies

| Dependency | Mocked |
|------------|:------:|
| `PrismaService.user.findFirst` | Yes |
| `PrismaService.teamMember.findMany` | Yes |

## Test cases (19)

- Blank/missing workspaceId or userId → fail-closed
- User not in workspace
- Deduplicated team memberships
- SQL with/without authorized teams
- `isChunkAuthorized` for WORKSPACE / TEAM / PRIVATE / unknown visibility

## Coverage

| Metric | Result |
|--------|--------|
| Statements | **100%** |
| Branches | **100%** |
| Functions | **100%** |
| Lines | **100%** |

## Production changes

None.

## Lessons learned

Pure ACL logic splits cleanly between async Prisma resolution and sync SQL/row checks — both are fully testable with a two-method Prisma stub.

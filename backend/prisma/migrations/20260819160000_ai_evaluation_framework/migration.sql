-- AI Workspace evaluation framework
CREATE TABLE IF NOT EXISTS "AiEvalCase" (
    "id" TEXT NOT NULL,
    "caseKey" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "expectedSources" JSONB NOT NULL,
    "expectedConfidence" TEXT,
    "tags" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiEvalCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiEvalCase_workspaceId_caseKey_key"
  ON "AiEvalCase"("workspaceId", "caseKey");
CREATE INDEX IF NOT EXISTS "AiEvalCase_workspaceId_idx" ON "AiEvalCase"("workspaceId");
CREATE INDEX IF NOT EXISTS "AiEvalCase_workspaceId_category_idx" ON "AiEvalCase"("workspaceId", "category");
CREATE INDEX IF NOT EXISTS "AiEvalCase_enabled_idx" ON "AiEvalCase"("enabled");

ALTER TABLE "AiEvalCase" DROP CONSTRAINT IF EXISTS "AiEvalCase_workspaceId_fkey";
ALTER TABLE "AiEvalCase"
  ADD CONSTRAINT "AiEvalCase_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AiEvalRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "averageAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageConfidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageResponseTimeMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passThreshold" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "meta" JSONB,

    CONSTRAINT "AiEvalRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiEvalRun_workspaceId_idx" ON "AiEvalRun"("workspaceId");
CREATE INDEX IF NOT EXISTS "AiEvalRun_workspaceId_startedAt_idx" ON "AiEvalRun"("workspaceId", "startedAt");
CREATE INDEX IF NOT EXISTS "AiEvalRun_status_idx" ON "AiEvalRun"("status");

ALTER TABLE "AiEvalRun" DROP CONSTRAINT IF EXISTS "AiEvalRun_workspaceId_fkey";
ALTER TABLE "AiEvalRun"
  ADD CONSTRAINT "AiEvalRun_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AiEvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT,
    "caseKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "aiAnswer" TEXT NOT NULL,
    "expectedSources" JSONB NOT NULL,
    "aiSources" JSONB NOT NULL,
    "expectedConfidence" TEXT,
    "aiConfidence" TEXT,
    "scores" JSONB NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "hallucinationFlags" JSONB NOT NULL,
    "missingContext" JSONB NOT NULL,
    "responseTimeMs" INTEGER NOT NULL,
    "responseLength" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvalResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiEvalResult_runId_idx" ON "AiEvalResult"("runId");
CREATE INDEX IF NOT EXISTS "AiEvalResult_caseId_idx" ON "AiEvalResult"("caseId");
CREATE INDEX IF NOT EXISTS "AiEvalResult_passed_idx" ON "AiEvalResult"("passed");
CREATE INDEX IF NOT EXISTS "AiEvalResult_createdAt_idx" ON "AiEvalResult"("createdAt");

ALTER TABLE "AiEvalResult" DROP CONSTRAINT IF EXISTS "AiEvalResult_runId_fkey";
ALTER TABLE "AiEvalResult"
  ADD CONSTRAINT "AiEvalResult_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AiEvalRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiEvalResult" DROP CONSTRAINT IF EXISTS "AiEvalResult_caseId_fkey";
ALTER TABLE "AiEvalResult"
  ADD CONSTRAINT "AiEvalResult_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "AiEvalCase"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

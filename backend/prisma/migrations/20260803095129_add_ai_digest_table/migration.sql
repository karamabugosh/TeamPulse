-- CreateTable
CREATE TABLE "AiDigest" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "blockers" JSONB NOT NULL,
    "themes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiDigest_teamId_idx" ON "AiDigest"("teamId");

-- AddForeignKey
ALTER TABLE "AiDigest" ADD CONSTRAINT "AiDigest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

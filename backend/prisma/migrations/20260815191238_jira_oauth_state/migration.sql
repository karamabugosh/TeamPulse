-- CreateTable
CREATE TABLE "JiraOAuthState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JiraOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JiraOAuthState_stateHash_key" ON "JiraOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "JiraOAuthState_workspaceId_expiresAt_idx" ON "JiraOAuthState"("workspaceId", "expiresAt");

-- CreateIndex
CREATE INDEX "JiraOAuthState_userId_expiresAt_idx" ON "JiraOAuthState"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "JiraOAuthState_expiresAt_idx" ON "JiraOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "JiraOAuthState_consumedAt_idx" ON "JiraOAuthState"("consumedAt");

-- AddForeignKey
ALTER TABLE "JiraOAuthState" ADD CONSTRAINT "JiraOAuthState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraOAuthState" ADD CONSTRAINT "JiraOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

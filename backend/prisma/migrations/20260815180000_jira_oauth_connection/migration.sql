-- CreateTable
CREATE TABLE "JiraConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "cloudId" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "atlassianAccountId" TEXT NOT NULL,
    "atlassianDisplayName" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JiraConnection_workspaceId_key" ON "JiraConnection"("workspaceId");

-- CreateIndex
CREATE INDEX "JiraConnection_cloudId_idx" ON "JiraConnection"("cloudId");

-- AddForeignKey
ALTER TABLE "JiraConnection" ADD CONSTRAINT "JiraConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

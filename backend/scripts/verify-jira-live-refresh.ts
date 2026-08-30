import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { WorkspaceKnowledgeService } from '../src/ai/workspace/knowledge/workspace-knowledge.service';
import { JiraService } from '../src/jira/jira.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { writeFileSync } from 'fs';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const knowledge = app.get(WorkspaceKnowledgeService);
  const jira = app.get(JiraService);
  const prisma = app.get(PrismaService);
  const conn = await jira.findRealJiraConnection();
  if (!conn) throw new Error('No real Jira connection');

  const before = await prisma.jiraIssueCacheEntry.findFirst({
    where: { issueKey: 'SCRUM-9', user: { workspaceId: conn.workspaceId } },
    select: { status: true, refreshedAt: true },
  });

  const result = await knowledge.collectSnapshot(
    conn.workspaceId,
    { issueKey: 'SCRUM-9', keyword: null },
    10,
  );
  const jiraDocs = result.documents.filter((d) => d.entity === 'jira_issue');
  const after = await prisma.jiraIssueCacheEntry.findFirst({
    where: { issueKey: 'SCRUM-9', userId: conn.userId },
    select: { status: true, refreshedAt: true, assigneeName: true, summary: true },
  });
  const live = await jira.lookupIssueForUser(conn.userId, 'SCRUM-9');

  writeFileSync(
    'jira-scrum9-fix-verify.json',
    JSON.stringify(
      {
        before,
        after,
        liveStatus: live?.status,
        doc: jiraDocs[0]
          ? {
              title: jiraDocs[0].title,
              content: jiraDocs[0].content,
              metadata: jiraDocs[0].metadata,
            }
          : null,
        diagnostic: result.diagnostics.find((d) => d.sourceKey === 'jira'),
      },
      null,
      2,
    ),
  );
  await app.close();
}

main().catch((e) => {
  writeFileSync(
    'jira-scrum9-fix-verify.json',
    JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
  );
  process.exit(1);
});

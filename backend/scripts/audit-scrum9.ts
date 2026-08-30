import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { JiraService } from '../src/jira/jira.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { writeFileSync } from 'fs';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const jira = app.get(JiraService);
  const prisma = app.get(PrismaService);
  const out: Record<string, unknown> = {};

  const conn = await jira.findRealJiraConnection();
  out.connection = conn
    ? {
        workspaceId: conn.workspaceId,
        cloudId: conn.cloudId,
        userId: conn.userId,
        display: conn.atlassianDisplayName,
      }
    : null;

  if (conn) {
    try {
      out.live = await jira.lookupIssueForUser(conn.userId, 'SCRUM-9');
    } catch (error) {
      out.liveError = error instanceof Error ? error.message : String(error);
      try {
        out.liveSearch = await jira.searchIssuesForUser(
          conn.userId,
          'key = SCRUM-9',
          5,
        );
      } catch (error2) {
        out.liveSearchError =
          error2 instanceof Error ? error2.message : String(error2);
      }
    }

    out.cache = await prisma.jiraIssueCacheEntry.findMany({
      where: {
        issueKey: 'SCRUM-9',
        user: { workspaceId: conn.workspaceId },
      },
      select: {
        status: true,
        summary: true,
        assigneeName: true,
        refreshedAt: true,
        jiraUpdatedAt: true,
      },
      take: 5,
    });
  }

  writeFileSync('jira-scrum9-audit.json', JSON.stringify(out, null, 2));
  await app.close();
}

main().catch((error) => {
  writeFileSync(
    'jira-scrum9-audit.json',
    JSON.stringify({
      fatal: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});

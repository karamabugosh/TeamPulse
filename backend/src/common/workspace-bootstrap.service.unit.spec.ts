import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceBootstrapService } from './workspace-bootstrap.service';
import { PrismaService } from '../prisma/prisma.service';

const authTestMock = jest.fn();

jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    auth: { test: authTestMock },
  })),
}));

jest.mock('./slack-member.util', () => ({
  isUsableSlackBotToken: jest.fn(),
}));

import { isUsableSlackBotToken } from './slack-member.util';

const isUsableSlackBotTokenMock = isUsableSlackBotToken as jest.MockedFunction<
  typeof isUsableSlackBotToken
>;

describe('WorkspaceBootstrapService', () => {
  let service: WorkspaceBootstrapService;
  let prisma: {
    workspace: {
      findFirst: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    authTestMock.mockReset();
    isUsableSlackBotTokenMock.mockReset();
    delete process.env.SLACK_BOT_TOKEN;

    prisma = {
      workspace: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceBootstrapService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(WorkspaceBootstrapService);
  });

  it('returns existing workspace id without calling Slack', async () => {
    prisma.workspace.findFirst.mockResolvedValue({ id: 'ws-existing' });

    await expect(service.ensureFromSlackToken()).resolves.toBe('ws-existing');
    expect(authTestMock).not.toHaveBeenCalled();
  });

  it('bootstraps workspace from SLACK_BOT_TOKEN when database is empty', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    prisma.workspace.findFirst.mockResolvedValue(null);
    isUsableSlackBotTokenMock.mockReturnValue(true);
    authTestMock.mockResolvedValue({ team_id: 'T123', team: 'Acme' });
    prisma.workspace.upsert.mockResolvedValue({
      id: 'ws-new',
      slackWorkspaceName: 'Acme',
    });

    await expect(service.ensureFromSlackToken()).resolves.toBe('ws-new');
    expect(prisma.workspace.upsert).toHaveBeenCalledWith({
      where: { slackWorkspaceId: 'T123' },
      update: {
        slackWorkspaceName: 'Acme',
        botToken: 'xoxb-test-token',
      },
      create: {
        slackWorkspaceId: 'T123',
        slackWorkspaceName: 'Acme',
        botToken: 'xoxb-test-token',
      },
    });
  });

  it('returns null when token is unusable', async () => {
    prisma.workspace.findFirst.mockResolvedValue(null);
    isUsableSlackBotTokenMock.mockReturnValue(false);

    await expect(service.ensureFromSlackToken()).resolves.toBeNull();
    expect(authTestMock).not.toHaveBeenCalled();
  });
});

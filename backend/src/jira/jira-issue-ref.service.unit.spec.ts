import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service';
import { JiraAuditService } from './jira-audit.service';
import { JiraCacheService } from './jira-cache.service';
import { JiraIssueRefService } from './jira-issue-ref.service';
import { JiraIssueSnapshot } from './jira-issue-ref.types';
import { JiraService } from './jira.service';

describe('JiraIssueRefService', () => {
  let service: JiraIssueRefService;
  let jiraCacheService: {
    resolveIssueKeysForUser: jest.MockedFunction<
      (userId: string, keys: string[]) => Promise<JiraIssueSnapshot[]>
    >;
  };

  const snapshot: JiraIssueSnapshot = {
    type: 'issue_ref',
    issueKey: 'SCRUM-1',
    issueId: '10001',
    summary: 'Fix login',
    status: 'In Progress',
    projectKey: 'SCRUM',
    projectName: 'Scrum',
    issueType: 'Bug',
    priority: 'High',
    issueUrl: 'https://jira.example/SCRUM-1',
    capturedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    jiraCacheService = {
      resolveIssueKeysForUser: jest.fn<
        (userId: string, keys: string[]) => Promise<JiraIssueSnapshot[]>
      >(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraIssueRefService,
        { provide: PrismaService, useValue: {} },
        { provide: JiraService, useValue: {} },
        { provide: JiraCacheService, useValue: jiraCacheService },
        { provide: JiraAuditService, useValue: {} },
      ],
    }).compile();

    service = module.get(JiraIssueRefService);
  });

  describe('buildSnapshotFromPickerValue', () => {
    it('parses a valid picker payload into a snapshot', () => {
      const raw = JSON.stringify(snapshot);
      expect(service.buildSnapshotFromPickerValue(raw)).toEqual(
        expect.objectContaining({
          type: 'issue_ref',
          issueKey: 'SCRUM-1',
          summary: 'Fix login',
        }),
      );
    });

    it('returns null for invalid picker payloads', () => {
      expect(service.buildSnapshotFromPickerValue('not-json')).toBeNull();
    });
  });

  describe('buildSnapshotFromIssueKey', () => {
    it('returns the first resolved snapshot for an uppercased key', async () => {
      jiraCacheService.resolveIssueKeysForUser.mockResolvedValue([snapshot]);

      const result = await service.buildSnapshotFromIssueKey('user-1', 'scrum-1');

      expect(result).toEqual(snapshot);
      expect(jiraCacheService.resolveIssueKeysForUser).toHaveBeenCalledWith(
        'user-1',
        ['SCRUM-1'],
      );
    });

    it('returns null when the cache resolves nothing', async () => {
      jiraCacheService.resolveIssueKeysForUser.mockResolvedValue([]);

      await expect(
        service.buildSnapshotFromIssueKey('user-1', 'MISSING-1'),
      ).resolves.toBeNull();
    });
  });

  describe('formatAnswerText', () => {
    it('delegates to formatIssueRefDisplay', () => {
      const text = service.formatAnswerText(snapshot);
      expect(text).toContain('SCRUM-1');
      expect(text).toContain('Fix login');
    });
  });

  describe('enrichFreeTextAnswer', () => {
    it('returns original text when zero issue keys are present', async () => {
      const result = await service.enrichFreeTextAnswer({
        userId: 'u1',
        text: 'no keys here',
      });

      expect(result).toEqual({ text: 'no keys here', structuredValue: null });
      expect(jiraCacheService.resolveIssueKeysForUser).not.toHaveBeenCalled();
    });

    it('returns original text when multiple issue keys are present', async () => {
      const result = await service.enrichFreeTextAnswer({
        userId: 'u1',
        text: 'Working SCRUM-1 and SCRUM-2',
      });

      expect(result.structuredValue).toBeNull();
      expect(jiraCacheService.resolveIssueKeysForUser).not.toHaveBeenCalled();
    });

    it('attaches a snapshot when exactly one key resolves', async () => {
      jiraCacheService.resolveIssueKeysForUser.mockResolvedValue([snapshot]);

      const result = await service.enrichFreeTextAnswer({
        userId: 'u1',
        text: 'Working on SCRUM-1 today',
      });

      expect(result).toEqual({
        text: 'Working on SCRUM-1 today',
        structuredValue: snapshot,
      });
    });

    it('returns null structuredValue when the single key does not resolve', async () => {
      jiraCacheService.resolveIssueKeysForUser.mockResolvedValue([]);

      const result = await service.enrichFreeTextAnswer({
        userId: 'u1',
        text: 'See ABC-9',
      });

      expect(result).toEqual({
        text: 'See ABC-9',
        structuredValue: null,
      });
    });
  });

  describe('getEnrichedDisplayForAnswer', () => {
    it('formats from structuredValue when present', async () => {
      const display = await service.getEnrichedDisplayForAnswer({
        text: 'raw',
        structuredValue: snapshot,
      });

      expect(display).toContain('SCRUM-1');
      expect(display).toContain('Fix login');
    });

    it('parses text as picker payload when structuredValue is absent', async () => {
      const display = await service.getEnrichedDisplayForAnswer({
        text: JSON.stringify(snapshot),
        structuredValue: null,
      });

      expect(display).toContain('SCRUM-1');
    });

    it('returns raw text when neither structuredValue nor text parses', async () => {
      const display = await service.getEnrichedDisplayForAnswer({
        text: 'plain answer',
        structuredValue: null,
      });

      expect(display).toBe('plain answer');
    });
  });

  describe('readSnapshotFromStructuredValue', () => {
    it('returns null for null, non-objects, and incomplete objects', () => {
      expect(service.readSnapshotFromStructuredValue(null)).toBeNull();
      expect(service.readSnapshotFromStructuredValue('x')).toBeNull();
      expect(service.readSnapshotFromStructuredValue({ type: 'issue_ref' })).toBeNull();
      expect(
        service.readSnapshotFromStructuredValue({
          type: 'other',
          issueKey: 'A-1',
          summary: 's',
        }),
      ).toBeNull();
    });

    it('normalizes a partial issue_ref object with defaults', () => {
      const result = service.readSnapshotFromStructuredValue({
        type: 'issue_ref',
        issueKey: 'SCRUM-7',
        summary: 'Partial',
      });

      expect(result).toEqual(
        expect.objectContaining({
          type: 'issue_ref',
          issueKey: 'SCRUM-7',
          issueId: 'SCRUM-7',
          summary: 'Partial',
          status: null,
          projectKey: null,
          projectName: null,
          issueType: null,
          priority: null,
          issueUrl: null,
        }),
      );
      expect(result?.capturedAt).toEqual(expect.any(String));
    });

    it('preserves provided optional fields including capturedAt', () => {
      const result = service.readSnapshotFromStructuredValue(snapshot);
      expect(result).toEqual(snapshot);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { WorkspaceKnowledgeService } from '../knowledge/workspace-knowledge.service';
import { GeneratedWorkspaceReport } from '../types/workspace-ai.types';
import { AnalysisOrchestratorService } from './analysis-orchestrator.service';
import {
  DecisionReplayAnalyzer,
  ProjectDetectiveAnalyzer,
} from './project-detective.analyzers';
import { DetectiveFocus } from './analysis.types';

describe('AnalysisOrchestratorService', () => {
  let service: AnalysisOrchestratorService;
  let knowledge: {
    resolveWorkspaceId: jest.MockedFunction<
      (id?: string | null) => Promise<string | null>
    >;
  };
  let projectDetective: {
    id: string;
    reportType: string;
    matches: jest.MockedFunction<(q: string) => boolean>;
    resolveFocus: jest.MockedFunction<(q: string) => DetectiveFocus>;
    analyze: jest.MockedFunction<(ctx: unknown) => Promise<GeneratedWorkspaceReport>>;
  };
  let decisionReplay: {
    id: string;
    reportType: string;
    matches: jest.MockedFunction<(q: string) => boolean>;
    resolveFocus: jest.MockedFunction<(q: string) => DetectiveFocus>;
    analyze: jest.MockedFunction<(ctx: unknown) => Promise<GeneratedWorkspaceReport>>;
  };

  const report = {
    title: 'Analysis',
  } as GeneratedWorkspaceReport;

  const focus = (overrides: Partial<DetectiveFocus> = {}): DetectiveFocus => ({
    issueKey: null,
    userQuery: null,
    sprintQuery: null,
    keyword: null,
    mode: 'root_cause',
    ...overrides,
  });

  beforeEach(async () => {
    knowledge = {
      resolveWorkspaceId: jest.fn<(id?: string | null) => Promise<string | null>>(),
    };
    projectDetective = {
      id: 'project_detective',
      reportType: 'PROJECT_DETECTIVE',
      matches: jest.fn<(q: string) => boolean>(),
      resolveFocus: jest.fn<(q: string) => DetectiveFocus>(),
      analyze: jest.fn(async () => report),
    };
    decisionReplay = {
      id: 'decision_replay',
      reportType: 'DECISION_REPLAY',
      matches: jest.fn<(q: string) => boolean>(),
      resolveFocus: jest.fn<(q: string) => DetectiveFocus>(),
      analyze: jest.fn(async () => report),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisOrchestratorService,
        { provide: WorkspaceKnowledgeService, useValue: knowledge },
        { provide: ProjectDetectiveAnalyzer, useValue: projectDetective },
        { provide: DecisionReplayAnalyzer, useValue: decisionReplay },
      ],
    }).compile();

    service = module.get(AnalysisOrchestratorService);
  });

  describe('isAnalysisRequest', () => {
    it('returns false for blank questions', () => {
      expect(service.isAnalysisRequest('   ')).toBe(false);
      expect(decisionReplay.matches).not.toHaveBeenCalled();
    });

    it('returns true when any analyzer matches', () => {
      decisionReplay.matches.mockReturnValue(false);
      projectDetective.matches.mockReturnValue(true);

      expect(service.isAnalysisRequest('why did SCRUM-1 slip?')).toBe(true);
    });

    it('returns false when no analyzer matches', () => {
      decisionReplay.matches.mockReturnValue(false);
      projectDetective.matches.mockReturnValue(false);

      expect(service.isAnalysisRequest('hello')).toBe(false);
    });
  });

  describe('pickAnalyzer', () => {
    it('prefers decisionReplay when it matches first', () => {
      decisionReplay.matches.mockReturnValue(true);
      projectDetective.matches.mockReturnValue(true);

      expect(service.pickAnalyzer('replay the decision')).toBe(decisionReplay);
      expect(projectDetective.matches).not.toHaveBeenCalled();
    });

    it('returns projectDetective when only it matches', () => {
      decisionReplay.matches.mockReturnValue(false);
      projectDetective.matches.mockReturnValue(true);

      expect(service.pickAnalyzer('root cause?')).toBe(projectDetective);
    });

    it('returns null when nothing matches', () => {
      decisionReplay.matches.mockReturnValue(false);
      projectDetective.matches.mockReturnValue(false);

      expect(service.pickAnalyzer('noop')).toBeNull();
    });
  });

  describe('analyze', () => {
    it('throws when workspace cannot be resolved', async () => {
      knowledge.resolveWorkspaceId.mockResolvedValue(null);

      await expect(
        service.analyze({ question: 'why blocked?' }),
      ).rejects.toThrow('No workspace available for project analysis');
    });

    it('uses projectDetective as default when no analyzer matches', async () => {
      knowledge.resolveWorkspaceId.mockResolvedValue('ws-1');
      decisionReplay.matches.mockReturnValue(false);
      projectDetective.matches.mockReturnValue(false);
      projectDetective.resolveFocus.mockReturnValue(
        focus({ issueKey: 'SCRUM-1', mode: 'root_cause' }),
      );

      const result = await service.analyze({
        workspaceId: 'ws-1',
        question: '  unexplained  ',
      });

      expect(result).toBe(report);
      expect(projectDetective.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          question: 'unexplained',
          focus: expect.objectContaining({ issueKey: 'SCRUM-1' }),
        }),
      );
      expect(decisionReplay.analyze).not.toHaveBeenCalled();
    });

    it('routes to decisionReplay and merges shared focus gaps', async () => {
      knowledge.resolveWorkspaceId.mockResolvedValue('ws-9');
      decisionReplay.matches.mockReturnValue(true);
      decisionReplay.resolveFocus.mockReturnValue(
        focus({
          mode: 'decision_replay',
          issueKey: null,
          userQuery: 'Sara',
        }),
      );

      await service.analyze({
        workspaceId: 'ws-9',
        question: 'decision replay for SCRUM-42 by Sara in sprint 3',
      });

      expect(decisionReplay.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          focus: expect.objectContaining({
            mode: 'decision_replay',
            userQuery: 'Sara',
            issueKey: 'SCRUM-42',
            sprintQuery: 'sprint 3',
          }),
        }),
      );
    });

    it('prefers analyzer focus fields over shared resolver when already set', async () => {
      knowledge.resolveWorkspaceId.mockResolvedValue('ws-1');
      decisionReplay.matches.mockReturnValue(true);
      decisionReplay.resolveFocus.mockReturnValue(
        focus({
          mode: 'decision_replay',
          issueKey: 'KEEP-1',
          userQuery: 'KeepUser',
          sprintQuery: 'sprint 9',
          keyword: 'latency',
        }),
      );

      await service.analyze({
        workspaceId: 'ws-1',
        question: 'decision replay SCRUM-99 by Other in sprint 1',
      });

      expect(decisionReplay.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          focus: {
            issueKey: 'KEEP-1',
            userQuery: 'KeepUser',
            sprintQuery: 'sprint 9',
            keyword: 'latency',
            mode: 'decision_replay',
          },
        }),
      );
    });

    it('logs none placeholders when merged focus fields are null', async () => {
      knowledge.resolveWorkspaceId.mockResolvedValue('ws-1');
      decisionReplay.matches.mockReturnValue(false);
      projectDetective.matches.mockReturnValue(false);
      projectDetective.resolveFocus.mockReturnValue(focus());

      await service.analyze({
        workspaceId: 'ws-1',
        question: 'generic analysis with no keys',
      });

      expect(projectDetective.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          focus: expect.objectContaining({
            issueKey: null,
            userQuery: null,
            sprintQuery: null,
          }),
        }),
      );
    });

    it('trims a missing question to empty string', async () => {
      knowledge.resolveWorkspaceId.mockResolvedValue('ws-1');
      decisionReplay.matches.mockReturnValue(false);
      projectDetective.matches.mockReturnValue(false);
      projectDetective.resolveFocus.mockReturnValue(focus());

      await service.analyze({
        question: undefined as unknown as string,
      });

      expect(projectDetective.analyze).toHaveBeenCalledWith(
        expect.objectContaining({ question: '' }),
      );
    });
  });
});

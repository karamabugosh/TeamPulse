/**
 * RAG + hybrid embedding types for Pulse AI Workspace.
 */
import type { AiPipelineTrace } from '../trace/ai-pipeline-trace.types';
import type { RagPipelineTraceMetrics } from '../trace/ai-pipeline-trace.types';

/** High-level data origin shown in citations. */
export type WorkspaceSourceType =
  | 'slack'
  | 'jira'
  | 'blockers'
  | 'reports'
  | 'users'
  | 'check_ins'
  | 'standup_runs'
  | 'team_memory'
  | 'ai_history';

/** Concrete entity kind inside the unified knowledge model. */
export type KnowledgeEntityType =
  | 'standup_submission'
  | 'standup_run'
  | 'standup_thread'
  | 'check_in'
  | 'jira_issue'
  | 'jira_audit'
  | 'blocker'
  | 'blocker_update'
  | 'report'
  | 'user'
  | 'team_memory'
  | 'ai_chat'
  | 'slack_channel'
  | 'jira_member';

export enum WorkspaceAiIntent {
  GET_BLOCKERS = 'GET_BLOCKERS',
  GET_USER_ACTIVITY = 'GET_USER_ACTIVITY',
  /** @deprecated Prefer SLACK_MEMBERS — kept for eval / older prompts. */
  LIST_MEMBERS = 'LIST_MEMBERS',
  /** Live Slack directory (users.list) → SlackMemberCache → TeamMember → Demo. */
  SLACK_MEMBERS = 'SLACK_MEMBERS',
  /** Live Jira directory (users/search) → JiraMemberCache → Demo. */
  JIRA_MEMBERS = 'JIRA_MEMBERS',
  SUMMARIZE_STANDUP = 'SUMMARIZE_STANDUP',
  /** Short issue lookup / status (not full detective). */
  ISSUE_STATUS = 'ISSUE_STATUS',
  ISSUE_ANALYSIS = 'ISSUE_ANALYSIS',
  PROJECT_DETECTIVE = 'PROJECT_DETECTIVE',
  ROOT_CAUSE_ANALYSIS = 'ROOT_CAUSE_ANALYSIS',
  DECISION_REPLAY = 'DECISION_REPLAY',
  SPRINT_REPLAY = 'SPRINT_REPLAY',
  SPRINT_REPORT = 'SPRINT_REPORT',
  EXECUTIVE_REPORT = 'EXECUTIVE_REPORT',
  GENERATE_REPORT = 'GENERATE_REPORT',
  VACATION_CATCHUP = 'VACATION_CATCHUP',
  TEAM_MEMORY_SEARCH = 'TEAM_MEMORY_SEARCH',
  GENERAL_QA = 'GENERAL_QA',
}

/** Dynamic workspace report kinds. */
export enum WorkspaceReportType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  SPRINT = 'sprint',
  BLOCKER = 'blocker',
  JIRA = 'jira',
  PERSONAL = 'personal',
  EXECUTIVE = 'executive',
  VACATION_CATCHUP = 'vacation_catchup',
  PROJECT_DETECTIVE = 'project_detective',
  DECISION_REPLAY = 'decision_replay',
}

export type ReportTimeRange = {
  from: string;
  to: string;
  label: string;
};

export type ReportSection = {
  id: string;
  title: string;
  markdown: string;
};

export type AiChatConfidence = 'High' | 'Medium' | 'Low';

export type GeneratedWorkspaceReport = {
  id: string;
  reportType: WorkspaceReportType;
  title: string;
  generatedAt: string;
  workspaceId: string;
  workspaceName: string;
  timeRange: ReportTimeRange;
  sections: ReportSection[];
  markdown: string;
  sourcesUsed: string[];
  confidence: AiChatConfidence;
  dataPoints: number;
  explanation: string;
  metrics: Record<string, unknown>;
};

/** Why a source returned zero (or few) documents for a request. */
export type SourceSearchReasonCode =
  | 'ok'
  | 'no_records_in_db'
  | 'filters_excluded_all'
  | 'not_searched_for_intent'
  | 'collector_error';

export type SourceSearchDiagnostic = {
  sourceKey: string;
  label: string;
  searched: boolean;
  found: number;
  totalInWorkspace: number;
  reasonCode: SourceSearchReasonCode;
  reason: string;
};

export type RetrievalPipelineLog = {
  intent: WorkspaceAiIntent | null;
  workspaceId: string;
  issueKey: string | null;
  sourcesSelected: string[];
  sourcesQueried: string[];
  retrievedDocumentsCount: number;
  documentsAfterMerge: number;
  documentsAfterDeduplication: number;
  documentsAfterReranking: number;
  promptSize?: number;
  finalSourcesUsed: string[];
};

export type RetrievalDiagnostics = {
  sources: SourceSearchDiagnostic[];
  summary: string;
  /** Multi-source RAG pipeline counters (intent → retrieve → merge → dedupe → rerank). */
  pipeline?: RetrievalPipelineLog;
  /** Hybrid retrieval metadata when semantic path ran. */
  hybrid?: {
    mode: 'keyword_only' | 'hybrid';
    keywordHits: number;
    semanticHits: number;
    embeddingsIndexed: number;
    fusedHits: number;
    /** pgvector ANN when available; otherwise in-app JSON cosine. */
    vectorBackend?: 'pgvector' | 'json' | 'none';
    semanticMs?: number;
    semanticScanned?: number;
  };
  /** Phase 3B — V2 Team Memory Ask Pulse integration diagnostics (safe; no private text). */
  v2Memory?: {
    mode: string;
    category: string;
    invoked: boolean;
    affectsAnswer: boolean;
    evidenceCount: number;
    vectorBackend?: string;
    durationMs?: number;
    error?: string;
    reason: string[];
  };
  /** Latest-standup temporal scoping diagnostics (safe; no private text). */
  temporalScope?: {
    temporalIntent: string | null;
    resolvedUserId: string | null;
    resolvedRunId: string | null;
    resolvedSubmissionId: string | null;
    scopedSourceCount: number;
    legacyFilteredOut: number;
    v2FilteredOut: number;
    resolutionReason: string | null;
  };
  /** Phase 3B evidence merge counters (safe). */
  evidenceMerge?: {
    inputCount: number;
    finalCount: number;
    v2Count: number;
    legacyCount: number;
    liveJiraCount: number;
    duplicatesRemoved: number;
    budgetDrops: number;
  };
};

export type WorkspaceSearchFilters = {
  issueKey?: string | null;
  userQuery?: string | null;
  standupQuery?: string | null;
  blockerQuery?: string | null;
  sprintQuery?: string | null;
  keyword?: string | null;
  /** Synonym-expanded tokens for collectors + ranking (never the full NL question). */
  searchTokens?: string[] | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  reportType?: WorkspaceReportType | null;
  /**
   * When true, factual Jira field questions (status/assignee/priority/…)
   * retrieve ONLY the live-refreshed jira_issue document — never Team Memory,
   * Reports, Slack, Demo narrative, or conversation history.
   */
  jiraFieldsOnly?: boolean | null;
  /** Optional explicit collector keys from source selection (multi-source RAG). */
  selectedSources?: string[] | null;
  /**
   * When true (SLACK_MEMBERS), only Slack member directory collectors run.
   * Never answer from Team Memory, Reports, Standups, or AI conversations.
   */
  slackMembersOnly?: boolean | null;
  /**
   * When true (JIRA_MEMBERS), only Jira member directory collectors run.
   * Never answer from Slack, Team Memory, Reports, Standups, or AI conversations.
   */
  jiraMembersOnly?: boolean | null;
  /**
   * When true (GET_BLOCKERS / count-list questions), load ALL workspace blockers
   * via JiraBlockerService (same as Blockers page) — no take/token filter.
   */
  blockersFullList?: boolean | null;
  /** Normalized temporal constraint — scopes retrieval, not a ranking hint. */
  temporalScope?: 'LATEST_STANDUP' | null;
  /** Phase 3B memory ask category from retrieval policy (server-only). */
  memoryAskCategory?:
    | 'CURRENT_JIRA_FIELD'
    | 'HISTORICAL_NARRATIVE'
    | 'COMPOSITE_JIRA_MEMORY'
    | 'OTHER'
    | null;
  /** Resolved Pulse User.id for the person named in the question (e.g. Karam). */
  subjectUserId?: string | null;
  /** Person named in an assignee list question (e.g. "issues assigned to Karam"). */
  assigneeQuery?: string | null;
  /** When true, retrieve Jira issues assigned to assigneeQuery (multi-issue list). */
  jiraAssigneeList?: boolean | null;
  latestStandupRunId?: string | null;
  latestStandupSubmissionId?: string | null;
  /** Source IDs (answers + blockers) belonging to the resolved latest standup scope. */
  latestStandupScopedSourceIds?: string[] | null;
};

/**
 * Source reference attached to every retrieved item.
 * Future OpenAI responses will cite these instead of inventing sources.
 */
export type SourceReference = {
  source: WorkspaceSourceType;
  entity: KnowledgeEntityType;
  entityId: string;
  timestamp: string | null;
  workspaceId: string;
  url: string | null;
  label: string;
};

/**
 * Unified knowledge document — single model for all workspace entities.
 */
export type KnowledgeDocument = {
  id: string;
  workspaceId: string;
  source: WorkspaceSourceType;
  entity: KnowledgeEntityType;
  title: string;
  content: string;
  timestamp: string | null;
  url: string | null;
  reference: SourceReference;
  metadata?: Record<string, unknown>;
  score?: number;
  /** Keyword rank contribution (0–1 normalized when hybrid). */
  keywordScore?: number;
  /** Cosine similarity from embeddings (0–1). */
  semanticScore?: number;
};

/** @deprecated Prefer KnowledgeDocument — kept for gradual migration. */
export type KnowledgeHit = KnowledgeDocument;

export type WorkspaceKnowledgeSnapshot = {
  workspaceId: string;
  documents: KnowledgeDocument[];
  byEntity: Partial<Record<KnowledgeEntityType, KnowledgeDocument[]>>;
  /** Convenience buckets */
  standups: KnowledgeDocument[];
  standupRuns: KnowledgeDocument[];
  standupThreads: KnowledgeDocument[];
  checkIns: KnowledgeDocument[];
  jiraIssues: KnowledgeDocument[];
  blockers: KnowledgeDocument[];
  blockerUpdates: KnowledgeDocument[];
  reports: KnowledgeDocument[];
  users: KnowledgeDocument[];
  teamMemory: KnowledgeDocument[];
  diagnostics: SourceSearchDiagnostic[];
};

export type WorkspaceSearchResult = {
  query: string;
  filters: WorkspaceSearchFilters;
  hits: KnowledgeDocument[];
  bySource: Partial<Record<WorkspaceSourceType, KnowledgeDocument[]>>;
  references: SourceReference[];
  diagnostics: RetrievalDiagnostics;
};

export type DetectedIntent = {
  intent: WorkspaceAiIntent;
  confidence: number;
  filters: WorkspaceSearchFilters;
  rationale: string;
};

export type BuiltContextChunk = {
  id: string;
  sourceType: WorkspaceSourceType;
  entity: KnowledgeEntityType;
  title: string;
  content: string;
  url?: string | null;
  reference: SourceReference;
  metadata?: Record<string, unknown>;
};

/** Named sections injected into the LLM prompt (multi-source RAG). */
export type ContextSectionId =
  | 'jira'
  | 'slack'
  | 'standups'
  | 'team_memory'
  | 'reports'
  | 'blockers'
  | 'ai_history'
  | 'users'
  | 'other';

export type BuiltContextSection = {
  id: ContextSectionId;
  title: string;
  chunks: BuiltContextChunk[];
  text: string;
};

export type BuiltContext = {
  intent: WorkspaceAiIntent;
  chunks: BuiltContextChunk[];
  /** Structured multi-source sections (JIRA / SLACK / …). */
  sections: BuiltContextSection[];
  contextText: string;
  tokenEstimate: number;
  insufficientData: boolean;
  references: SourceReference[];
  /** Source buckets present in the final grounded context. */
  finalSourcesUsed: WorkspaceSourceType[];
};

export type BuiltPrompt = {
  system: string;
  user: string;
  intent: WorkspaceAiIntent;
  /** Ready for OpenAI chat.completions later */
  messages: Array<{ role: 'system' | 'user'; content: string }>;
};

export type AiProviderMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiProviderRequest = {
  messages: AiProviderMessage[];
  history?: AiProviderMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type AiProviderResponse = {
  content: string;
  model: string;
  provider: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type WorkspaceCitation = {
  id: string;
  sourceType: WorkspaceSourceType;
  label: string;
  title: string;
  url?: string | null;
  reference?: SourceReference;
};

export type RenderedAiResponse = {
  markdown: string;
  plainText: string;
  citations: WorkspaceCitation[];
  sources: WorkspaceSourceType[];
};

export type ConversationTurn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: WorkspaceAiIntent;
  citations?: WorkspaceCitation[];
  confidence?: AiChatConfidence;
  createdAt: string;
};

export type ConversationSession = {
  id: string;
  workspaceId: string;
  turns: ConversationTurn[];
  createdAt: string;
  updatedAt: string;
  /** Pending vacation catch-up date collection */
  vacationPending?: {
    awaiting: 'start' | 'end';
    startIso?: string;
    focusUserName?: string | null;
  } | null;
};

export type WorkspaceAskRequest = {
  workspaceId?: string | null;
  conversationId?: string | null;
  question: string;
  reportType?: WorkspaceReportType | null;
  /** Optional focus person for personalization (e.g. Slack display name). */
  focusUserName?: string | null;
  /**
   * Trusted Pulse User.id for ACL (Phase 3B V2 memory).
   * Must come from server auth/session — never invent team membership from the client.
   * When omitted, V2 memory is skipped (fail closed).
   */
  userId?: string | null;
};

/**
 * RAG prepare response.
 */
export type RagPrepareResponse = {
  workspaceId: string;
  question: string;
  intent: DetectedIntent;
  retrieval: {
    hitCount: number;
    filters: WorkspaceSearchFilters;
    hits: KnowledgeDocument[];
    references: SourceReference[];
    diagnostics: RetrievalDiagnostics;
  };
  context: BuiltContext;
  prompt: BuiltPrompt;
  generation: {
    status: 'ready_for_openai' | 'not_implemented';
    message: string;
  };
  /** Internal metrics for pipeline trace (safe; no secrets). */
  traceMetrics?: RagPipelineTraceMetrics;
};

/** Legacy ask shape. */
export type WorkspaceAskResponse = {
  conversationId: string | null;
  intent: WorkspaceAiIntent;
  answer: RenderedAiResponse | null;
  insufficientData: boolean;
  provider: string;
  model: string | null;
  rag: RagPrepareResponse;
};

export type AiChatSourceItem = {
  id: string;
  source: WorkspaceSourceType;
  label: string;
  title: string;
  date: string | null;
  url: string | null;
  entity: KnowledgeEntityType;
};

export type AiChatResponse = {
  conversationId: string;
  question: string;
  intent: WorkspaceAiIntent;
  intentConfidence: number;
  answer: string;
  sources: AiChatSourceItem[];
  confidence: AiChatConfidence;
  insufficientData: boolean;
  provider: string;
  model: string | null;
  retrievalDiagnostics?: RetrievalDiagnostics;
  /** Structured per-request pipeline trace (sanitized; admin/debug). */
  pipelineTrace?: AiPipelineTrace | null;
  report?: GeneratedWorkspaceReport | null;
};

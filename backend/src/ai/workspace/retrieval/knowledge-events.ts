/** Event name for knowledge mutations that should refresh embeddings. */
export const WORKSPACE_KNOWLEDGE_CHANGED = 'workspace.knowledge.changed';

export type WorkspaceKnowledgeChangedEvent = {
  workspaceId: string;
  reason: string;
};

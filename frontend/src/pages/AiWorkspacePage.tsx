import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AiWorkspaceHero } from '@/components/ai-workspace/AiWorkspaceHero';
import {
  AiWorkspaceSearchBar,
  type AiWorkspaceSearchBarHandle,
} from '@/components/ai-workspace/AiWorkspaceSearchBar';
import { AiSuggestedPrompts } from '@/components/ai-workspace/AiSuggestedPrompts';
import { AiConversationArea } from '@/components/ai-workspace/AiConversationArea';
import {
  AiConversationHistory,
  type AiConversationListItem,
} from '@/components/ai-workspace/AiConversationHistory';
import type {
  AiChatApiResponse,
  AiChatMessage,
} from '@/components/ai-workspace/ai-workspace.types';
import { apiFetch, ApiError } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type ConversationDetailResponse = {
  id: string;
  workspaceId: string;
  title: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
    confidence: 'High' | 'Medium' | 'Low' | null;
    citations: Array<{
      id: string;
      label: string;
      title: string;
      date: string | null;
      source: string;
      url: string | null;
    }>;
  }>;
};

/**
 * AI Workspace — grounded chat with persisted, workspace-scoped history.
 */
const AiWorkspacePage: React.FC = () => {
  const { workspaceId, activeWorkspace } = useWorkspace();
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<AiConversationListItem[]>(
    [],
  );
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchBarRef = useRef<AiWorkspaceSearchBarHandle>(null);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      searchBarRef.current?.focus();
    });
  }, []);

  const refreshHistory = useCallback(
    async (searchOverride?: string) => {
      if (!workspaceId) {
        setConversations([]);
        return;
      }
      setHistoryLoading(true);
      try {
        const q = (searchOverride ?? historyQuery).trim();
        const qs = new URLSearchParams({
          workspaceId,
          limit: '40',
        });
        if (q) qs.set('q', q);
        const response = await apiFetch<{
          conversations: AiConversationListItem[];
        }>(`/api/ai/workspace/conversations?${qs.toString()}`);
        setConversations(response.conversations ?? []);
      } catch (err) {
        console.error(err);
        setConversations([]);
      } finally {
        setHistoryLoading(false);
      }
    },
    [workspaceId, historyQuery],
  );

  useEffect(() => {
    // Switching workspace clears the open thread and reloads that tenant's history.
    setMessages([]);
    setConversationId(null);
    setError(null);
    setHistoryQuery('');
  }, [workspaceId]);

  // Debounced conversation search within the active workspace.
  useEffect(() => {
    if (!workspaceId) {
      setConversations([]);
      return;
    }
    const timer = setTimeout(() => {
      void refreshHistory();
    }, 280);
    return () => clearTimeout(timer);
  }, [historyQuery, workspaceId, refreshHistory]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
    setQuery('');
    focusInput();
  }, [focusInput]);

  const handleOpenConversation = useCallback(
    async (id: string) => {
      if (!workspaceId) return;
      setError(null);
      setLoading(true);
      try {
        const detail = await apiFetch<ConversationDetailResponse>(
          `/api/ai/workspace/conversations/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        );
        setConversationId(detail.id);
        setMessages(
          detail.messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            createdAt: msg.createdAt,
            confidence: msg.confidence,
            citations: (msg.citations ?? []).map((c) => ({
              id: c.id,
              label: c.label,
              title: c.title,
              date: c.date,
              sourceType: c.source,
              url: c.url,
            })),
          })),
        );
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : 'Could not open that conversation.';
        setError(message);
      } finally {
        setLoading(false);
        focusInput();
      }
    },
    [workspaceId, focusInput],
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      if (!workspaceId) return;
      try {
        await apiFetch(
          `/api/ai/workspace/conversations/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
          { method: 'DELETE' },
        );
        if (conversationId === id) {
          handleNewChat();
        }
        await refreshHistory();
      } catch (err) {
        console.error(err);
        setError('Could not delete conversation.');
      }
    },
    [workspaceId, conversationId, handleNewChat, refreshHistory],
  );

  const handleAsk = useCallback(
    async (nextQuery: string) => {
      const question = nextQuery.trim();
      if (!question || loading) return;

      setError(null);
      setLoading(true);
      setQuery('');

      const userMessage: AiChatMessage = {
        id: newId(),
        role: 'user',
        content: question,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, userMessage]);

      try {
        const response = await apiFetch<AiChatApiResponse>(
          '/api/ai/workspace/chat',
          {
            method: 'POST',
            body: JSON.stringify({
              question,
              conversationId,
              workspaceId,
            }),
          },
        );

        setConversationId(response.conversationId);

        const assistantMessage: AiChatMessage = {
          id: newId(),
          role: 'assistant',
          content: response.answer,
          createdAt: new Date().toISOString(),
          confidence: response.confidence,
          report: response.report ?? null,
          citations: (response.sources ?? []).map((source) => ({
            id: source.id,
            label: source.label,
            title: source.title,
            date: source.date,
            sourceType: source.source,
            url: source.url,
          })),
          pipelineTrace: response.pipelineTrace ?? null,
        };

        setMessages((current) => [...current, assistantMessage]);
        void refreshHistory();
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : 'Failed to get an AI response. Please try again.';
        setError(message);
        setMessages((current) => [
          ...current,
          {
            id: newId(),
            role: 'assistant',
            content: message,
            createdAt: new Date().toISOString(),
            confidence: 'Low',
            citations: [],
          },
        ]);
      } finally {
        setLoading(false);
        focusInput();
      }
    },
    [conversationId, loading, focusInput, workspaceId, refreshHistory],
  );

  const handlePromptSelect = useCallback((prompt: string) => {
    setQuery(prompt);
    requestAnimationFrame(() => {
      searchBarRef.current?.focus();
    });
  }, []);

  const showStarters = messages.length === 0 && !loading;

  return (
    <div className="relative mx-auto w-full max-w-6xl pb-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[320px] bg-[radial-gradient(ellipse_at_top,_rgba(139,92,246,0.18),_transparent_55%),radial-gradient(ellipse_at_80%_20%,_rgba(6,182,212,0.12),_transparent_45%)]"
      />

      <div className="flex flex-col">
        {activeWorkspace ? (
          <div className="mb-2 flex justify-center">
            <Badge variant="secondary" className="gap-1.5">
              <Sparkles className="h-3 w-3" />
              Grounded on {activeWorkspace.name}
            </Badge>
          </div>
        ) : null}
        <AiWorkspaceHero />

        <div className="mt-6 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
          <AiConversationHistory
            conversations={conversations}
            activeId={conversationId}
            loading={historyLoading}
            searchQuery={historyQuery}
            onSearchChange={setHistoryQuery}
            onSelect={(id) => void handleOpenConversation(id)}
            onNewChat={handleNewChat}
            onDelete={(id) => void handleDeleteConversation(id)}
          />

          <div className="min-w-0">
            <div className="sticky top-0 z-20 bg-background/80 py-3 backdrop-blur-md">
              <AiWorkspaceSearchBar
                ref={searchBarRef}
                value={query}
                onChange={setQuery}
                onSubmit={(value) => void handleAsk(value)}
                disabled={loading}
              />
            </div>

            {showStarters ? (
              <div className="mt-3">
                <AiSuggestedPrompts
                  onSelect={handlePromptSelect}
                  disabled={loading}
                />
              </div>
            ) : null}

            {error ? (
              <p className="mx-auto mt-2 max-w-3xl px-4 text-center text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <div className="mt-4">
              <AiConversationArea messages={messages} loading={loading} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiWorkspacePage;

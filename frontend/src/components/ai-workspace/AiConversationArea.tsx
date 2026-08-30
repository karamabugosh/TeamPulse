import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  FileText,
  Layers,
  MessageSquare,
  Database,
  Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AiReportCard } from './AiReportCard';
import {
  SendToSlackDialog,
  type SlackSendPayload,
} from './SendToSlackDialog';
import type { AiChatConfidence, AiChatMessage } from './ai-workspace.types';
import { showAiChatSources, showAiPipelineTrace } from './ai-chat-display.flags';
import { AiPipelineTracePanel } from './AiPipelineTracePanel';

const CAPABILITIES = [
  { label: 'Slack standups', icon: MessageSquare },
  { label: 'Jira', icon: Layers },
  { label: 'Reports', icon: FileText },
  { label: 'Blockers', icon: AlertTriangle },
  { label: 'Team Memory', icon: Database },
] as const;

interface AiConversationAreaProps {
  messages?: AiChatMessage[];
  loading?: boolean;
}

/**
 * Groups chronological messages into Q&A turns (user + following assistants).
 * Storage order stays chronological; display reverses turns so newest is first.
 */
function groupIntoTurns(messages: AiChatMessage[]): AiChatMessage[][] {
  const turns: AiChatMessage[][] = [];
  let current: AiChatMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      if (current.length > 0) turns.push(current);
      current = [message];
      continue;
    }

    if (current.length === 0) {
      turns.push([message]);
    } else {
      current.push(message);
    }
  }

  if (current.length > 0) turns.push(current);
  return turns;
}

function confidenceVariant(confidence: AiChatConfidence) {
  if (confidence === 'High') return 'success' as const;
  if (confidence === 'Medium') return 'warning' as const;
  return 'secondary' as const;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** Lightweight markdown for chat answers (bold, italics, lists, code). */
function renderAnswerMarkdown(content: string): React.ReactNode {
  const lines = content.split('\n');
  return lines.map((line, index) => {
    const key = `l-${index}`;
    const trimmed = line.trim();
    if (!trimmed) {
      return <br key={key} />;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);

    const inline = formatInlineMarkdown(bullet?.[1] ?? numbered?.[1] ?? heading?.[1] ?? trimmed);

    if (heading) {
      return (
        <p key={key} className="mt-2 font-semibold text-foreground first:mt-0">
          {inline}
        </p>
      );
    }
    if (bullet || numbered) {
      return (
        <p key={key} className="pl-3 text-foreground/95">
          <span className="mr-1.5 text-cyan-300/80">•</span>
          {inline}
        </p>
      );
    }
    return (
      <p key={key} className="leading-relaxed">
        {inline}
      </p>
    );
  });
}

function formatInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(
        <strong key={`b-${i}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      parts.push(
        <code
          key={`c-${i}`}
          className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(
        <em key={`i-${i}`} className="italic text-foreground/90">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MessageBubble({
  message,
  hideBody,
  onSendToSlack,
}: {
  message: AiChatMessage;
  /** When true, skip content body (used for report assistants). */
  hideBody?: boolean;
  onSendToSlack?: (message: AiChatMessage) => void;
}) {
  const isUser = message.role === 'user';

  if (!isUser && hideBody) {
    return null;
  }

  return (
    <article
      data-role={message.role}
      className={
        isUser
          ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-module-ai/20 px-4 py-3 text-sm text-foreground shadow-glow-sm'
          : 'mr-auto max-w-[95%] rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-foreground'
      }
    >
      <div className={isUser ? 'whitespace-pre-wrap leading-relaxed' : 'space-y-1'}>
        {isUser ? message.content : renderAnswerMarkdown(message.content)}
      </div>

      {!isUser ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-2.5">
          {message.confidence ? (
            <Badge variant={confidenceVariant(message.confidence)}>
              Confidence · {message.confidence}
            </Badge>
          ) : null}

          <p className="text-[10px] text-muted-foreground/70">
            {formatTime(message.createdAt)}
          </p>

          {onSendToSlack ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="ml-auto h-8 gap-1.5"
              onClick={() => onSendToSlack(message)}
            >
              <span aria-hidden>📨</span>
              Send to Slack
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-muted-foreground/70">
          {formatTime(message.createdAt)}
        </p>
      )}

      {!isUser &&
      showAiChatSources() &&
      message.citations &&
      message.citations.length > 0 ? (
        <div className="mt-2.5 space-y-1.5" data-ai-citations>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sources
          </p>
          <div className="flex flex-wrap gap-1.5">
            {message.citations.map((citation) => (
              <span
                key={citation.id}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100"
                title={citation.title || citation.label}
              >
                <span className="font-medium">{citation.label}</span>
                {citation.date ? (
                  <span className="text-cyan-200/70">{citation.date}</span>
                ) : null}
                {citation.title ? (
                  <span className="max-w-[12rem] truncate text-cyan-200/80">
                    · {citation.title}
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {!isUser &&
      showAiPipelineTrace() &&
      message.pipelineTrace?.visible ? (
        <AiPipelineTracePanel trace={message.pipelineTrace} />
      ) : null}
    </article>
  );
}

function TypingIndicator() {
  return (
    <div
      className="mr-auto flex max-w-[70%] items-center gap-2 rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.03] px-4 py-3"
      aria-live="polite"
      aria-label="Pulse AI is typing"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
      <span className="text-xs text-muted-foreground">Pulse AI is thinking…</span>
      <span className="flex items-center gap-1 pl-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/80" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/60 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/40 [animation-delay:300ms]" />
      </span>
    </div>
  );
}

export const AiConversationArea: React.FC<AiConversationAreaProps> = ({
  messages = [],
  loading = false,
}) => {
  const hasMessages = messages.length > 0;
  const topRef = useRef<HTMLDivElement>(null);
  const [slackOpen, setSlackOpen] = useState(false);
  const [slackPayload, setSlackPayload] = useState<SlackSendPayload | null>(
    null,
  );
  const [slackNotice, setSlackNotice] = useState<string | null>(null);

  const openAnswerSlack = (message: AiChatMessage) => {
    setSlackPayload({
      contentType: 'answer',
      title: 'Pulse AI Answer',
      body: message.content,
      confidence: message.confidence ?? null,
      sources: (message.citations ?? []).map((citation) => ({
        label: citation.label,
        title: citation.title ?? null,
        url: citation.url ?? null,
      })),
      reportType: 'answer',
      report: null,
    });
    setSlackOpen(true);
  };

  const turnsNewestFirst = useMemo(() => {
    const chronologicalTurns = groupIntoTurns(messages);
    return [...chronologicalTurns].reverse();
  }, [messages]);

  useEffect(() => {
    if (!hasMessages && !loading) return;
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, loading, hasMessages]);

  if (!hasMessages && !loading) {
    return (
      <section
        className="mx-auto w-full max-w-3xl px-4"
        aria-label="AI conversation"
        data-ai-conversation
      >
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-6 text-center sm:px-6">
          <p className="text-sm text-muted-foreground">
            Ask a question or generate a report from your workspace data only.
          </p>
          <ul className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {CAPABILITIES.map(({ label, icon: Icon }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-muted-foreground"
              >
                <Icon className="h-3.5 w-3.5 text-cyan-400/80" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section
      className="mx-auto w-full max-w-3xl px-4"
      aria-label="AI conversation"
      data-ai-conversation
      data-order="newest-first"
    >
      <div ref={topRef} aria-hidden className="h-px" />

      <div className="space-y-5" data-ai-messages>
        {turnsNewestFirst.map((turn, turnIndex) => {
          const isNewest = turnIndex === 0;
          const turnKey = turn.map((message) => message.id).join(':');
          const waitingOnThisTurn =
            loading && isNewest && turn.every((message) => message.role === 'user');
          const reportMessage = turn.find(
            (message) => message.role === 'assistant' && message.report,
          );
          const report = reportMessage?.report ?? null;

          return (
            <div
              key={turnKey}
              data-ai-turn={isNewest ? 'latest' : 'history'}
              className={`space-y-3 ${isNewest ? 'animate-chat-insert' : ''}`}
            >
              {turn.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  hideBody={Boolean(report && message.role === 'assistant')}
                  onSendToSlack={
                    !report && message.role === 'assistant'
                      ? openAnswerSlack
                      : undefined
                  }
                />
              ))}

              {report ? (
                <AiReportCard report={report} stickyActions={isNewest} />
              ) : null}

              {waitingOnThisTurn ? <TypingIndicator /> : null}
            </div>
          );
        })}

        {loading && turnsNewestFirst.length === 0 ? <TypingIndicator /> : null}
      </div>

      {slackNotice ? (
        <p className="mt-3 text-center text-xs text-cyan-200/80">{slackNotice}</p>
      ) : null}

      <SendToSlackDialog
        open={slackOpen}
        onOpenChange={setSlackOpen}
        payload={slackPayload}
        onSuccess={({ channelName, sentAt }) => {
          const notice = `✓ Successfully sent to Slack · ${channelName} · ${new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          setSlackNotice(notice);
          window.setTimeout(() => setSlackNotice(null), 5000);
        }}
      />
    </section>
  );
};

export default AiConversationArea;

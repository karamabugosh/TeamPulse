import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiChatService } from '../ai/workspace/chat/ai-chat.service';
import { AiChatResponse } from '../ai/workspace/types/workspace-ai.types';
import { PrismaService } from '../prisma/prisma.service';
import { SlackService } from './slack.service';

const SLACK_MESSAGE_SOFT_LIMIT = 3200;
const REPORT_FILE_THRESHOLD = 2800;

type SlackAiHandleParams = {
  slackUserId: string;
  channelId: string;
  question: string;
  /** Parent message ts — used as thread root for replies. */
  messageTs: string;
  threadTs?: string;
  source: 'dm' | 'app_mention';
};

/**
 * Slack → Pulse AI bridge.
 * Reuses AiChatService / RAG / report engine — no second AI stack.
 */
@Injectable()
export class SlackAiAssistantService {
  private readonly logger = new Logger(SlackAiAssistantService.name);

  /** Maps Slack thread (channel:threadTs) → AI conversationId */
  private readonly conversationByThread = new Map<string, string>();

  constructor(
    private readonly aiChat: AiChatService,
    private readonly prisma: PrismaService,
    private readonly slackService: SlackService,
  ) {}

  async handleQuestion(params: SlackAiHandleParams): Promise<void> {
    const startedAt = Date.now();
    const question = params.question?.trim() ?? '';
    if (!question) {
      await this.slackService.postMessage({
        channelId: params.channelId,
        threadTs: params.threadTs ?? params.messageTs,
        text: 'Ask me anything about your workspace — standups, blockers, Jira, or reports.',
      });
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { slackUserId: params.slackUserId },
      select: {
        id: true,
        workspaceId: true,
        slackDisplayName: true,
        slackUserId: true,
      },
    });

    if (!user) {
      await this.slackService.postMessage({
        channelId: params.channelId,
        threadTs: params.threadTs ?? params.messageTs,
        text: "I couldn't map your Slack account to a Pulse workspace user. Please message PulseBot once so we can register you.",
      });
      return;
    }

    const replyThreadTs = params.threadTs ?? params.messageTs;
    const conversationKey = `${params.channelId}:${replyThreadTs}`;
    const conversationId =
      this.conversationByThread.get(conversationKey) ?? null;

    const personalized = personalizeFirstPerson(
      question,
      user.slackDisplayName,
    );

    this.logger.log(
      `Slack AI request source=${params.source} user=${user.slackDisplayName} (${user.slackUserId}) workspace=${user.workspaceId} q="${question.slice(0, 120)}"`,
    );

    const thinking = await this.slackService.postMessage({
      channelId: params.channelId,
      threadTs: replyThreadTs,
      text: ':hourglass_flowing_sand: Pulse AI is thinking…',
      debugContext: 'slack-ai-typing',
    });

    try {
      const response = await this.aiChat.chat({
        workspaceId: user.workspaceId,
        conversationId,
        question: personalized,
        focusUserName: user.slackDisplayName,
      });

      this.conversationByThread.set(
        conversationKey,
        response.conversationId,
      );

      const responseTimeMs = Date.now() - startedAt;
      const formatted = formatSlackAiReply(response);

      await this.persistLog({
        workspaceId: user.workspaceId,
        userId: user.id,
        slackUserId: user.slackUserId,
        channelId: params.channelId,
        threadTs: replyThreadTs,
        question,
        answer: response.answer,
        sources: response.sources,
        confidence: response.confidence,
        intent: response.intent,
        conversationId: response.conversationId,
        responseTimeMs,
      });

      const shouldUploadReport =
        Boolean(response.report) &&
        (response.report!.markdown.length >= REPORT_FILE_THRESHOLD ||
          formatted.length >= SLACK_MESSAGE_SOFT_LIMIT);

      if (shouldUploadReport && response.report) {
        const summary = [
          `*${response.report.title}*`,
          `Confidence: *${response.confidence}*`,
          `Generated: ${new Date().toLocaleString()}`,
          '',
          '_Full report attached as a file._',
          '',
          formatSourcesLine(response.sources),
        ].join('\n');

        if (thinking.ok && thinking.ts) {
          await this.slackService.updateMessage({
            channelId: params.channelId,
            ts: thinking.ts,
            text: summary,
          });
        } else {
          await this.slackService.postMessage({
            channelId: params.channelId,
            threadTs: replyThreadTs,
            text: summary,
          });
        }

        const upload = await this.slackService.uploadTextFile({
          channelId: params.channelId,
          threadTs: replyThreadTs,
          filename: `${response.report.reportType}-report-${response.report.generatedAt.slice(0, 10)}.md`,
          title: response.report.title,
          content: response.report.markdown,
          initialComment: 'Pulse AI report (export-ready Markdown)',
        });

        if (!upload.ok) {
          await this.slackService.postMessage({
            channelId: params.channelId,
            threadTs: replyThreadTs,
            text: truncateForSlack(formatted, SLACK_MESSAGE_SOFT_LIMIT),
          });
        }

        this.logger.log(
          `Slack AI report reply user=${user.slackUserId} ms=${responseTimeMs} upload=${upload.ok}`,
        );
        return;
      }

      const text = truncateForSlack(formatted, SLACK_MESSAGE_SOFT_LIMIT);

      if (thinking.ok && thinking.ts) {
        await this.slackService.updateMessage({
          channelId: params.channelId,
          ts: thinking.ts,
          text,
        });
      } else {
        await this.slackService.postMessage({
          channelId: params.channelId,
          threadTs: replyThreadTs,
          text,
        });
      }

      this.logger.log(
        `Slack AI reply user=${user.slackUserId} intent=${response.intent} confidence=${response.confidence} ms=${responseTimeMs}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Slack AI failed user=${params.slackUserId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      const fallback =
        "I couldn't find enough information in your workspace.";

      if (thinking.ok && thinking.ts) {
        await this.slackService.updateMessage({
          channelId: params.channelId,
          ts: thinking.ts,
          text: fallback,
        });
      } else {
        await this.slackService.postMessage({
          channelId: params.channelId,
          threadTs: replyThreadTs,
          text: fallback,
        });
      }

      await this.persistLog({
        workspaceId: user.workspaceId,
        userId: user.id,
        slackUserId: user.slackUserId,
        channelId: params.channelId,
        threadTs: replyThreadTs,
        question,
        answer: fallback,
        sources: [],
        confidence: 'Low',
        intent: 'ERROR',
        conversationId,
        responseTimeMs: Date.now() - startedAt,
      });
    }
  }

  private async persistLog(params: {
    workspaceId: string;
    userId: string;
    slackUserId: string;
    channelId: string;
    threadTs: string | null;
    question: string;
    answer: string;
    sources: AiChatResponse['sources'] | unknown;
    confidence: string | null;
    intent: string | null;
    conversationId: string | null;
    responseTimeMs: number;
  }): Promise<void> {
    try {
      await this.prisma.slackAiChatLog.create({
        data: {
          workspaceId: params.workspaceId,
          userId: params.userId,
          slackUserId: params.slackUserId,
          channelId: params.channelId,
          threadTs: params.threadTs,
          question: params.question,
          answer: params.answer,
          sources: params.sources as Prisma.InputJsonValue,
          confidence: params.confidence,
          intent: params.intent,
          conversationId: params.conversationId,
          responseTimeMs: params.responseTimeMs,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to persist Slack AI log: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** Rewrite first-person so RAG resolves the Slack user (e.g. Karam). */
export function personalizeFirstPerson(
  question: string,
  displayName: string,
): string {
  if (!displayName?.trim()) return question;
  if (!/\b(i|i'm|i’m|i've|i’ve|me|my|mine)\b/i.test(question)) {
    return question;
  }

  const name = displayName.trim();
  return question
    .replace(/\bI'm\b/gi, `${name} is`)
    .replace(/\bI’m\b/gi, `${name} is`)
    .replace(/\bI am\b/gi, `${name} is`)
    .replace(/\bI've\b/gi, `${name} has`)
    .replace(/\bI’ve\b/gi, `${name} has`)
    .replace(/\bme\b/gi, name)
    .replace(/\bmy\b/gi, `${name}'s`)
    .replace(/\bmine\b/gi, `${name}'s`)
    .replace(/\bI\b/g, name);
}

function formatSourcesLine(
  sources: AiChatResponse['sources'] | undefined,
): string {
  if (!sources?.length) return 'Sources: _none_';
  const labels = sources
    .slice(0, 8)
    .map((source) => source.label || source.title)
    .filter(Boolean);
  return `Sources: ${labels.join(' · ')}`;
}

function formatSlackAiReply(response: AiChatResponse): string {
  const generatedAt = new Date().toLocaleString();
  const answerBody = response.insufficientData
    ? "I couldn't find enough information in your workspace."
    : stripHeavyMarkdown(response.answer);

  const lines = [
    answerBody.trim(),
    '',
    `*Confidence:* ${response.confidence}`,
    formatSourcesLine(response.sources),
    `*Generated:* ${generatedAt}`,
  ];

  return lines.join('\n');
}

function stripHeavyMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^---+$/gm, '')
    .trim();
}

function truncateForSlack(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 40).trim()}\n\n_…truncated — ask for a shorter summary._`;
}
